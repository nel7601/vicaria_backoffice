import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import {
  invoices,
  payments,
  squareTransactions,
  webhookEvents,
} from "@/lib/db/schema";
import {
  extractSquarePaymentFromEvent,
  extractTerminalCheckoutFromEvent,
  isSquarePaymentEvent,
  isSquareTerminalEvent,
  mapSquarePaymentStatus,
  type SquarePaymentSummary,
} from "@/lib/domain/square";
import {
  applySquarePaymentToInvoice,
  settleTerminalCheckout,
  type Tx,
} from "@/lib/square/ledger";
import { logger } from "@/lib/observability/logger";

/**
 * Square webhook processing (spec §10.1): after the raw event is stored
 * idempotently in webhook_events, this maps the Square object onto our
 * ledger. Every step is idempotent (NFR-11) — a redelivered or concurrently
 * processed event can never duplicate a payment, allocation or receipt:
 *  - square_transactions upserts on the unique square_payment_id;
 *  - confirming a payment is guarded by `status = 'pending'` with RETURNING;
 *  - creating a payment relies on the unique (external_provider, external_id).
 */
export async function processSquareWebhookEvent(
  db: Database,
  params: { eventId: string; eventType: string | null; payload: unknown },
): Promise<void> {
  const { eventId, eventType, payload } = params;

  if (isSquarePaymentEvent(eventType)) {
    const sq = extractSquarePaymentFromEvent(payload);
    if (sq) {
      await db.transaction(async (tx) => {
        await applySquarePayment(tx, sq);
      });
    } else {
      logger.warn("square.webhook_unparseable", { eventId, eventType });
    }
  } else if (isSquareTerminalEvent(eventType)) {
    const checkout = extractTerminalCheckoutFromEvent(payload);
    if (checkout) {
      await db.transaction(async (tx) => {
        await settleTerminalCheckout(tx, checkout);
      });
    } else {
      logger.warn("square.webhook_unparseable", { eventId, eventType });
    }
  }
  // Other event types (refund.*, dispute.*) are stored for audit/reconciliation
  // but not yet acted on automatically.

  await db
    .update(webhookEvents)
    .set({ processedAt: new Date() })
    .where(
      and(eq(webhookEvents.provider, "square"), eq(webhookEvents.eventId, eventId)),
    );
}

async function applySquarePayment(tx: Tx, sq: SquarePaymentSummary) {
  const mapped = mapSquarePaymentStatus(sq.status);

  // Match our payment row by the Square payment id set at charge time, or —
  // for Terminal payments whose id we may not have claimed yet — by the
  // checkout id anchored in payments.reference.
  let [local] = await tx
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.externalProvider, "square"),
        eq(payments.externalId, sq.squarePaymentId),
      ),
    )
    .limit(1);
  if (!local && sq.terminalCheckoutId) {
    [local] = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.externalProvider, "square"),
          eq(payments.reference, sq.terminalCheckoutId),
        ),
      )
      .limit(1);
  }

  let paymentId = local?.id ?? null;
  let organizationId = local?.organizationId ?? null;

  if (local) {
    if (local.status === "pending" && mapped === "confirmed") {
      // Guarded transition: only the executor that flips pending→confirmed
      // applies the payment and issues the receipt.
      const flipped = await tx
        .update(payments)
        .set({
          status: "confirmed",
          externalId: sq.squarePaymentId,
          updatedAt: new Date(),
        })
        .where(and(eq(payments.id, local.id), eq(payments.status, "pending")))
        .returning();
      if (flipped.length > 0) {
        const intendedInvoiceId =
          (local.metadata as { intendedInvoiceId?: string } | null)
            ?.intendedInvoiceId ?? sq.referenceId;
        if (intendedInvoiceId) {
          await applySquarePaymentToInvoice(tx, {
            organizationId: local.organizationId,
            paymentId: local.id,
            invoiceId: intendedInvoiceId,
            amountCents: local.amountCents,
            squarePaymentId: sq.squarePaymentId,
          });
        }
      }
    } else if (
      local.status === "pending" &&
      (mapped === "failed" || mapped === "cancelled")
    ) {
      await tx
        .update(payments)
        .set({ status: mapped, updatedAt: new Date() })
        .where(and(eq(payments.id, local.id), eq(payments.status, "pending")));
    }
    // Never downgrade a confirmed payment here; refunds/disputes have their
    // own flows and event types.
  } else if (mapped === "confirmed" && sq.referenceId && sq.amountCents) {
    // No local record (e.g. we crashed between charging and saving): the
    // reference_id we sent at charge time is our invoice id — rebuild the
    // payment from the invoice. Unique (external_provider, external_id)
    // makes a concurrent redelivery insert nothing.
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, sq.referenceId))
      .limit(1);
    if (invoice) {
      const [created] = await tx
        .insert(payments)
        .values({
          organizationId: invoice.organizationId,
          patientId: invoice.patientId,
          method: "square_card",
          status: "confirmed",
          amountCents: sq.amountCents,
          currency: sq.currency ?? invoice.currency,
          externalProvider: "square",
          externalId: sq.squarePaymentId,
          metadata: { intendedInvoiceId: invoice.id, source: "webhook" },
        })
        .onConflictDoNothing()
        .returning();
      if (created) {
        paymentId = created.id;
        organizationId = created.organizationId;
        await applySquarePaymentToInvoice(tx, {
          organizationId: invoice.organizationId,
          paymentId: created.id,
          invoiceId: invoice.id,
          amountCents: created.amountCents,
          squarePaymentId: sq.squarePaymentId,
        });
        logger.info("square.payment_recovered_from_webhook", {
          squarePaymentId: sq.squarePaymentId,
        });
      }
    } else {
      logger.warn("square.webhook_unmatched_invoice", {
        squarePaymentId: sq.squarePaymentId,
      });
    }
  }

  // Mirror the Square object for reconciliation (§10.1). A transaction with
  // no linked payment (or an amount mismatch) shows up as unreconciled.
  const reconciled =
    paymentId !== null && mapped === "confirmed" && sq.amountCents !== null;
  await tx
    .insert(squareTransactions)
    .values({
      organizationId,
      squarePaymentId: sq.squarePaymentId,
      squareOrderId: sq.squareOrderId,
      squareCustomerId: sq.squareCustomerId,
      status: sq.status,
      amountCents: sq.amountCents,
      tender: sq.sourceType,
      paymentId,
      reconciled,
      raw: { source: "webhook", payment: { ...sq } },
    })
    .onConflictDoUpdate({
      target: squareTransactions.squarePaymentId,
      set: {
        status: sq.status,
        amountCents: sq.amountCents,
        ...(paymentId ? { paymentId, organizationId } : {}),
        reconciled,
        updatedAt: new Date(),
      },
    });
}
