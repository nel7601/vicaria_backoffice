import { describe, expect, it } from "vitest";
import {
  canRefund,
  derivePaymentStatus,
  formatInvoiceNumber,
} from "@/lib/domain/invoice";

describe("invoice numbering (§FR-INV-002)", () => {
  it("pads sequence with prefix", () => {
    expect(formatInvoiceNumber("VIC-", 1)).toBe("VIC-00001");
    expect(formatInvoiceNumber("INV-", 12345)).toBe("INV-12345");
  });
});

describe("refund guards (§FR-REF-001)", () => {
  it("rejects refunds beyond the refundable amount", () => {
    expect(
      canRefund({ proposedCents: 6000, paymentAmountCents: 5000, alreadyRefundedCents: 0 }).ok,
    ).toBe(false);
    expect(
      canRefund({ proposedCents: 3000, paymentAmountCents: 5000, alreadyRefundedCents: 3000 }).ok,
    ).toBe(false);
  });
  it("accepts a valid partial refund", () => {
    expect(
      canRefund({ proposedCents: 2000, paymentAmountCents: 5000, alreadyRefundedCents: 0 }).ok,
    ).toBe(true);
  });
});

describe("payment status derivation (Appendix A)", () => {
  it("reflects refunds", () => {
    expect(derivePaymentStatus(10000, 0)).toBe("confirmed");
    expect(derivePaymentStatus(10000, 4000)).toBe("partially_refunded");
    expect(derivePaymentStatus(10000, 10000)).toBe("refunded");
  });
});
