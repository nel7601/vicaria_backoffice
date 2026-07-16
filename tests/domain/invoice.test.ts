import { describe, expect, it } from "vitest";
import {
  balanceCents,
  canAllocate,
  computeInvoiceTotals,
  deriveInvoiceStatus,
  receiptableCents,
} from "@/lib/domain/invoice";

describe("computeInvoiceTotals", () => {
  it("computes subtotal, discount and tax per line", () => {
    const totals = computeInvoiceTotals([
      { quantity: 2, unitPriceCents: 5000, taxRateBps: 1300 }, // 100.00 + 13%
      { quantity: 1, unitPriceCents: 3000, discountCents: 500, taxRateBps: 0 },
    ]);
    expect(totals.subtotalCents).toBe(13000);
    expect(totals.discountCents).toBe(500);
    // tax only on first line net (10000) = 1300
    expect(totals.taxCents).toBe(1300);
    expect(totals.totalCents).toBe(13000 - 500 + 1300);
  });
});

describe("deriveInvoiceStatus", () => {
  const base = {
    issued: true,
    voided: false,
    fullyRefunded: false,
    totalCents: 10000,
    allocatedCents: 0,
    dueDate: null,
  };

  it("is draft before issue", () => {
    expect(deriveInvoiceStatus({ ...base, issued: false })).toBe("draft");
  });
  it("is paid when fully allocated", () => {
    expect(deriveInvoiceStatus({ ...base, allocatedCents: 10000 })).toBe("paid");
  });
  it("is partially_paid with a partial allocation", () => {
    expect(deriveInvoiceStatus({ ...base, allocatedCents: 4000 })).toBe(
      "partially_paid",
    );
  });
  it("is overdue past due date with no payment", () => {
    const due = new Date("2020-01-01");
    expect(
      deriveInvoiceStatus({ ...base, dueDate: due, now: new Date("2020-02-01") }),
    ).toBe("overdue");
  });
  it("void and refunded are terminal", () => {
    expect(deriveInvoiceStatus({ ...base, voided: true })).toBe("void");
    expect(deriveInvoiceStatus({ ...base, fullyRefunded: true })).toBe(
      "refunded",
    );
  });
});

describe("payment allocation guardrails (§FR-PAY-002)", () => {
  it("rejects allocation exceeding invoice balance", () => {
    const r = canAllocate({
      proposedCents: 6000,
      paymentAmountCents: 10000,
      alreadyAllocatedFromPaymentCents: 0,
      invoiceBalanceCents: 5000,
    });
    expect(r.ok).toBe(false);
  });
  it("rejects allocation exceeding available payment", () => {
    const r = canAllocate({
      proposedCents: 6000,
      paymentAmountCents: 10000,
      alreadyAllocatedFromPaymentCents: 7000,
      invoiceBalanceCents: 9000,
    });
    expect(r.ok).toBe(false);
  });
  it("accepts a valid allocation", () => {
    const r = canAllocate({
      proposedCents: 3000,
      paymentAmountCents: 10000,
      alreadyAllocatedFromPaymentCents: 0,
      invoiceBalanceCents: 5000,
    });
    expect(r.ok).toBe(true);
  });
});

describe("receipt never exceeds confirmed allocations (§FR-REC-001)", () => {
  it("sums confirmed allocations only", () => {
    expect(receiptableCents([2000, 3000])).toBe(5000);
    expect(balanceCents(10000, 5000)).toBe(5000);
  });
});
