import { and, eq, ne } from "drizzle-orm";
import type { Database } from "@/lib/db";
import {
  invoices,
  paymentAllocations,
  payments,
  receipts,
  squareTransactions,
} from "@/lib/db/schema";
import {
  mapTerminalCheckoutStatus,
  type TerminalCheckoutSummary,
} from "@/lib/domain/square";
import { balanceCents, deriveInvoiceStatus } from "@/lib/domain/invoice";
import { logger } from "@/lib/observability/logger";

/**
 * Shared Square ledger operations (spec §10.1), used by both the webhook
 * processor and the front-desk polling actions. Everything here runs inside
 * a caller-provided transaction and is idempotent (NFR-11): confirmations
 * are guarded by `status = 'pending'` with RETURNING, so webhook and polling
 * can race safely — exactly one executor applies the payment.
 */

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type SquareSettleOutcome =
  | "confirmed"
  | "cancelled"
  | "pending"
  | "failed"
  | "not_found";

/**
 * Apply a confirmed payment to its invoice and issue the receipt — the same
 * shape as the cash flow in billing actions. Applies at most the open
 * balance; any surplus stays as an unapplied confirmed payment.
 */
export async function applySquarePaymentToInvoice(
  tx: Tx,
  params: {
    organizationId: string;
    paymentId: string;
    invoiceId: string;
    amountCents: number;
    squarePaymentId: string | null;
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
  await recomputeInvoiceFromAllocations(
    tx,
    params.organizationId,
    params.invoiceId,
  );
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
export async function recomputeInvoiceFromAllocations(
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

/**
 * Settle a Terminal checkout against the local payment that anchored it
 * (payments.reference = checkout id, set when the checkout was pushed).
 * Called from the webhook and from the front-desk polling action.
 */
export async function settleTerminalCheckout(
  tx: Tx,
  checkout: TerminalCheckoutSummary,
): Promise<SquareSettleOutcome> {
  const [local] = await tx
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.externalProvider, "square"),
        eq(payments.reference, checkout.checkoutId),
      ),
    )
    .limit(1);
  if (!local) {
    logger.warn("square.terminal_checkout_unmatched", {
      checkoutId: checkout.checkoutId,
    });
    return "not_found";
  }

  if (local.status !== "pending") {
    // Already settled by a previous webhook/poll.
    if (local.status === "confirmed") return "confirmed";
    if (local.status === "cancelled") return "cancelled";
    if (local.status === "failed") return "failed";
    return "confirmed";
  }

  const mapped = mapTerminalCheckoutStatus(checkout.status);
  if (mapped === "pending") return "pending";

  if (mapped === "cancelled") {
    await tx
      .update(payments)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(payments.id, local.id), eq(payments.status, "pending")));
    return "cancelled";
  }

  // COMPLETED — claim the Square payment id and apply.
  const squarePaymentId = checkout.paymentIds[0] ?? null;
  if (squarePaymentId) {
    const [other] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.externalProvider, "square"),
          eq(payments.externalId, squarePaymentId),
          ne(payments.id, local.id),
        ),
      )
      .limit(1);
    if (other) {
      // The payment.updated webhook already rebuilt this charge as its own
      // row; retire the anchor so the ledger holds the charge exactly once.
      await tx
        .update(payments)
        .set({
          status: "cancelled",
          metadata: {
            ...((local.metadata as Record<string, unknown>) ?? {}),
            supersededByPaymentId: other.id,
          },
          updatedAt: new Date(),
        })
        .where(and(eq(payments.id, local.id), eq(payments.status, "pending")));
      return "confirmed";
    }
  }

  const flipped = await tx
    .update(payments)
    .set({
      status: "confirmed",
      externalId: squarePaymentId,
      updatedAt: new Date(),
    })
    .where(and(eq(payments.id, local.id), eq(payments.status, "pending")))
    .returning();
  if (flipped.length === 0) return "confirmed";

  if (squarePaymentId) {
    await tx
      .insert(squareTransactions)
      .values({
        organizationId: local.organizationId,
        squarePaymentId,
        status: checkout.status,
        amountCents: checkout.amountCents,
        tender: "CARD_PRESENT",
        paymentId: local.id,
        reconciled: true,
        raw: { source: "terminal_checkout", checkout: { ...checkout } },
      })
      .onConflictDoUpdate({
        target: squareTransactions.squarePaymentId,
        set: {
          paymentId: local.id,
          organizationId: local.organizationId,
          reconciled: true,
          updatedAt: new Date(),
        },
      });
  }

  const intendedInvoiceId =
    (local.metadata as { intendedInvoiceId?: string } | null)
      ?.intendedInvoiceId ?? checkout.referenceId;
  if (intendedInvoiceId) {
    await applySquarePaymentToInvoice(tx, {
      organizationId: local.organizationId,
      paymentId: local.id,
      invoiceId: intendedInvoiceId,
      amountCents: local.amountCents,
      squarePaymentId,
    });
  }
  return "confirmed";
}
