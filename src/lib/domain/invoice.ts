import { sumCents, taxOnCents } from "./money";

/**
 * Invoice financial logic (spec §6.7, Appendix A).
 * Status is DERIVED from totals and allocations, never edited freely
 * (§FR-INV-003). Totals are computed from line items so a PDF reproduces
 * deterministically from the snapshot (§FR-INV-004).
 */

export type InvoiceStatus =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "void"
  | "refunded";

export interface InvoiceLine {
  quantity: number;
  unitPriceCents: number;
  discountCents?: number;
  taxRateBps?: number;
}

export interface InvoiceTotals {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

/** Compute frozen totals from lines (§FR-INV-001). */
export function computeInvoiceTotals(lines: InvoiceLine[]): InvoiceTotals {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;

  for (const line of lines) {
    const gross = line.quantity * line.unitPriceCents;
    const lineDiscount = line.discountCents ?? 0;
    const net = Math.max(0, gross - lineDiscount);
    subtotal += gross;
    discount += lineDiscount;
    tax += taxOnCents(net, line.taxRateBps ?? 0);
  }

  const total = Math.max(0, subtotal - discount + tax);
  return {
    subtotalCents: subtotal,
    discountCents: discount,
    taxCents: tax,
    totalCents: total,
  };
}

export interface InvoiceStateInput {
  /** True once issued (invoice_number assigned). */
  issued: boolean;
  voided: boolean;
  fullyRefunded: boolean;
  totalCents: number;
  /** Sum of confirmed payment allocations to this invoice. */
  allocatedCents: number;
  dueDate?: Date | null;
  now?: Date;
}

/**
 * Derive invoice status from its financial facts (§FR-INV-003, Appendix A).
 * Order of precedence: void/refunded terminal states first, then payment state.
 */
export function deriveInvoiceStatus(input: InvoiceStateInput): InvoiceStatus {
  if (input.voided) return "void";
  if (input.fullyRefunded) return "refunded";
  if (!input.issued) return "draft";

  const paid = input.allocatedCents;
  if (paid >= input.totalCents && input.totalCents > 0) return "paid";
  if (paid > 0) return "partially_paid";

  const now = input.now ?? nowGuard();
  if (input.dueDate && input.dueDate < now) return "overdue";
  return "issued";
}

export function balanceCents(totalCents: number, allocatedCents: number): number {
  return Math.max(0, totalCents - allocatedCents);
}

/**
 * Validate a proposed allocation never exceeds the payment's available amount
 * or the invoice balance (§FR-PAY-002 acceptance criterion).
 */
export function canAllocate(params: {
  proposedCents: number;
  paymentAmountCents: number;
  alreadyAllocatedFromPaymentCents: number;
  invoiceBalanceCents: number;
}): { ok: boolean; reason?: string } {
  if (params.proposedCents <= 0) {
    return { ok: false, reason: "Allocation must be positive." };
  }
  const paymentAvailable =
    params.paymentAmountCents - params.alreadyAllocatedFromPaymentCents;
  if (params.proposedCents > paymentAvailable) {
    return { ok: false, reason: "Exceeds available payment amount." };
  }
  if (params.proposedCents > params.invoiceBalanceCents) {
    return { ok: false, reason: "Exceeds invoice balance." };
  }
  return { ok: true };
}

/** A receipt may never show more than the confirmed allocations (§FR-REC-001). */
export function receiptableCents(confirmedAllocations: number[]): number {
  return sumCents(confirmedAllocations);
}

/** Format an immutable sequential invoice number (§FR-INV-002). */
export function formatInvoiceNumber(prefix: string, sequence: number): string {
  return `${prefix}${String(sequence).padStart(5, "0")}`;
}

/**
 * Validate a proposed refund against the original payment (§FR-REF-001):
 * never more than the confirmed payment amount minus what was already refunded.
 */
export function canRefund(params: {
  proposedCents: number;
  paymentAmountCents: number;
  alreadyRefundedCents: number;
}): { ok: boolean; reason?: string } {
  if (params.proposedCents <= 0) {
    return { ok: false, reason: "Refund must be positive." };
  }
  const available = params.paymentAmountCents - params.alreadyRefundedCents;
  if (params.proposedCents > available) {
    return { ok: false, reason: "Exceeds refundable amount." };
  }
  return { ok: true };
}

/** Derive payment status from refunds against it (Appendix A). */
export function derivePaymentStatus(
  amountCents: number,
  refundedCents: number,
  base: "pending" | "confirmed" = "confirmed",
): "pending" | "confirmed" | "partially_refunded" | "refunded" {
  if (refundedCents <= 0) return base;
  if (refundedCents >= amountCents) return "refunded";
  return "partially_refunded";
}

// `new Date()` is unavailable inside workflow scripts; in app runtime it is fine.
function nowGuard(): Date {
  return new Date();
}

/**
 * Cash-discount amount for one line (compliant "tax-equivalent" discount):
 * the discount D such that (gross - D) + tax(gross - D) ≈ gross, i.e. the
 * customer pays the pre-tax sticker price while HST is still charged and
 * remitted on the discounted base. D = gross · r / (1 + r).
 */
export function cashDiscountCents(
  grossCents: number,
  taxRateBps: number,
): number {
  if (taxRateBps <= 0 || grossCents <= 0) return 0;
  const r = taxRateBps / 10000;
  return Math.round((grossCents * r) / (1 + r));
}

/** Fixed description for the rounding line added by the cash discount. */
export const CASH_ROUNDING_DESCRIPTION = "Rounding adjustment";

/**
 * Apply the tax-equivalent cash discount to a set of lines so the invoice
 * total lands EXACTLY on the pre-tax sticker price. Per-line rounding of
 * discount and tax can overshoot/undershoot by a cent (e.g. $100 → $100.01),
 * so this nudges discounts down to get at-or-below the target and reports
 * the remaining cents as a zero-tax rounding adjustment line to add.
 */
export function applyCashDiscount<T extends InvoiceLine>(
  lines: T[],
): { lines: T[]; adjustmentCents: number } {
  const target = lines.reduce(
    (sum, l) => sum + l.quantity * l.unitPriceCents,
    0,
  );
  let adjusted = lines.map((l) => ({
    ...l,
    discountCents: cashDiscountCents(
      l.quantity * l.unitPriceCents,
      l.taxRateBps ?? 0,
    ),
  }));
  let total = computeInvoiceTotals(adjusted).totalCents;

  // Bump a taxed line's discount by a cent at a time until total <= target.
  let guard = 0;
  while (total > target && guard < 10) {
    const idx = adjusted.findIndex(
      (l) =>
        (l.taxRateBps ?? 0) > 0 &&
        (l.discountCents ?? 0) < l.quantity * l.unitPriceCents,
    );
    if (idx === -1) break;
    adjusted = adjusted.map((l, i) =>
      i === idx ? { ...l, discountCents: (l.discountCents ?? 0) + 1 } : l,
    );
    total = computeInvoiceTotals(adjusted).totalCents;
    guard++;
  }

  return { lines: adjusted, adjustmentCents: Math.max(0, target - total) };
}
