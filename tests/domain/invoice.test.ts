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

describe("cash discount (tax-equivalent, compliant)", () => {
  it("discounts the base so discounted base + tax equals the sticker price", async () => {
    const { cashDiscountCents, computeInvoiceTotals } = await import(
      "@/lib/domain/invoice"
    );
    const gross = 15000; // $150.00 @ 13% HST
    const d = cashDiscountCents(gross, 1300);
    const totals = computeInvoiceTotals([
      { quantity: 1, unitPriceCents: gross, discountCents: d, taxRateBps: 1300 },
    ]);
    // Out-the-door total matches the pre-tax price within a cent.
    expect(Math.abs(totals.totalCents - gross)).toBeLessThanOrEqual(1);
    // Tax is still charged on the discounted base (not zero).
    expect(totals.taxCents).toBeGreaterThan(0);
  });

  it("is zero for tax-free lines", async () => {
    const { cashDiscountCents } = await import("@/lib/domain/invoice");
    expect(cashDiscountCents(15000, 0)).toBe(0);
  });
});

describe("applyCashDiscount lands exactly on the sticker price", () => {
  it("fixes the $100 @ 13% case (was $100.01)", async () => {
    const { applyCashDiscount, computeInvoiceTotals, CASH_ROUNDING_DESCRIPTION } =
      await import("@/lib/domain/invoice");
    const { lines, adjustmentCents } = applyCashDiscount([
      { quantity: 1, unitPriceCents: 10000, taxRateBps: 1300 },
    ]);
    const items =
      adjustmentCents > 0
        ? [
            ...lines,
            {
              quantity: 1,
              unitPriceCents: adjustmentCents,
              taxRateBps: 0,
              description: CASH_ROUNDING_DESCRIPTION,
            },
          ]
        : lines;
    expect(computeInvoiceTotals(items).totalCents).toBe(10000);
  });

  it("hits the target across many price points", async () => {
    const { applyCashDiscount, computeInvoiceTotals } = await import(
      "@/lib/domain/invoice"
    );
    for (const price of [10000, 15000, 9900, 12345, 20000, 7550, 100]) {
      const { lines, adjustmentCents } = applyCashDiscount([
        { quantity: 1, unitPriceCents: price, taxRateBps: 1300 },
      ]);
      const total =
        computeInvoiceTotals(lines).totalCents + adjustmentCents;
      expect(total).toBe(price);
      // Tax is still charged on the discounted base.
      expect(computeInvoiceTotals(lines).taxCents).toBeGreaterThan(0);
    }
  });

  it("handles multi-line invoices with mixed tax rates", async () => {
    const { applyCashDiscount, computeInvoiceTotals } = await import(
      "@/lib/domain/invoice"
    );
    const input = [
      { quantity: 2, unitPriceCents: 7500, discountCents: 0, taxRateBps: 1300 },
      { quantity: 1, unitPriceCents: 9000, discountCents: 0, taxRateBps: 1300 },
      { quantity: 1, unitPriceCents: 5000, discountCents: 0, taxRateBps: 0 }, // exempt
    ];
    const target = 2 * 7500 + 9000 + 5000;
    const { lines, adjustmentCents } = applyCashDiscount(input);
    expect(computeInvoiceTotals(lines).totalCents + adjustmentCents).toBe(target);
    // The exempt line keeps no discount.
    expect(lines[2].discountCents).toBe(0);
  });
});
