import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import {
  invoices,
  paymentAllocations,
  payments,
  receipts,
  squareTransactions,
  webhookEvents,
} from "@/lib/db/schema";
import {
  extractSquarePaymentFromEvent,
  isSquarePaymentEvent,
  mapSquarePaymentStatus,
  type SquarePaymentSummary,
} from "@/lib/domain/square";
import { balanceCents, deriveInvoiceStatus } from "@/lib/domain/invoice";
import { logger } from "@/lib/observability/logger";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Square webhook processing (spec §10.1): after the raw event is stored
 * idempotently in webhook_events, this maps the Square payment onto our
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

  // Match our payment row by the Square payment id set at charge time.
  const [local] = await tx
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.externalProvider, "square"),
        eq(payments.externalId, sq.squarePaymentId),
      ),
    )
    .limit(1);

  let paymentId = local?.id ?? null;
  let organizationId = local?.organizationId ?? null;

  if (local) {
    if (local.status === "pending" && mapped === "confirmed") {
      // Guarded transition: only the executor that flips pending→confirmed
      // applies the payment and issues the receipt.
      const flipped = await tx
        .update(payments)
        .set({ status: "confirmed", updatedAt: new Date() })
        .where(and(eq(payments.id, local.id), eq(payments.status, "pending")))
        .returning();
      if (flipped.length > 0) {
        const intendedInvoiceId =
          (local.metadata as { intendedInvoiceId?: string } | null)
            ?.intendedInvoiceId ?? sq.referenceId;
        if (intendedInvoiceId) {
          await applyToInvoice(tx, {
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
        await applyToInvoice(tx, {
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

/**
 * Apply a confirmed payment to its invoice and issue the receipt — the same
 * shape as the cash flow in billing actions. Applies at most the open
 * balance; any surplus stays as an unapplied confirmed payment.
 */
async function applyToInvoice(
  tx: Tx,
  params: {
    organizationId: string;
    paymentId: string;
    invoiceId: string;
    amountCents: number;
    squarePaymentId: string;
  },
) {
  const [invoice] = await tx
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, params.organizationId),
        eq(invoices.id, params.invoiceId),
      ),
    )
    .limit(1);
  if (!invoice || invoice.balanceCents <= 0) return;

  const applied = Math.min(params.amountCents, invoice.balanceCents);
  await tx.insert(paymentAllocations).values({
    organizationId: params.organizationId,
    paymentId: params.paymentId,
    invoiceId: params.invoiceId,
    amountCents: applied,
  });
  await recomputeInvoice(tx, params.organizationId, params.invoiceId);
  await tx.insert(receipts).values({
    organizationId: params.organizationId,
    paymentId: params.paymentId,
    invoiceId: params.invoiceId,
    amountCents: applied,
    language: invoice.language,
    snapshot: {
      invoiceNumber: invoice.invoiceNumber,
      amountCents: applied,
      currency: invoice.currency,
      method: "square_card",
      squarePaymentId: params.squarePaymentId,
    },
  });
}

/**
 * Recompute paid/balance/status from confirmed allocations, on the SAME
 * executor so uncommitted rows are visible (mirrors billing actions).
 */
async function recomputeInvoice(
  tx: Tx,
  organizationId: string,
  invoiceId: string,
) {
  const [inv] = await tx
    .select()
    .from(invoices)
    .where(
      and(eq(invoices.organizationId, organizationId), eq(invoices.id, invoiceId)),
    )
    .limit(1);
  if (!inv) return;

  const { sql } = await import("drizzle-orm");
  const [row] = await tx
    .select({
      total: sql<number>`coalesce(sum(${paymentAllocations.amountCents}), 0)::int`,
    })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(
      and(
        eq(paymentAllocations.invoiceId, invoiceId),
        eq(payments.status, "confirmed"),
      ),
    );
  const allocated = Number(row?.total ?? 0);
  const status = deriveInvoiceStatus({
    issued: inv.invoiceNumber !== null,
    voided: inv.status === "void",
    fullyRefunded: false,
    totalCents: inv.totalCents,
    allocatedCents: allocated,
    dueDate: inv.dueDate,
  });
  await tx
    .update(invoices)
    .set({
      paidCents: allocated,
      balanceCents: balanceCents(inv.totalCents, allocated),
      status,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId));
}
