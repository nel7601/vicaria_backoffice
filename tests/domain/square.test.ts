import { describe, expect, it } from "vitest";
import {
  computeSquareSignature,
  extractSquarePaymentFromEvent,
  isSquarePaymentEvent,
  mapSquarePaymentStatus,
  normalizeSquarePayment,
  squareErrorMessage,
  squareEventId,
  verifySquareSignature,
} from "@/lib/domain/square";

describe("Square webhook signature (§10.1)", () => {
  const url = "https://vicaria.example/api/webhooks/square";
  const body = '{"event_id":"evt_123","type":"payment.created"}';
  const key = "test-signature-key";

  it("verifies a correct signature", () => {
    const sig = computeSquareSignature(url, body, key);
    expect(
      verifySquareSignature({
        notificationUrl: url,
        rawBody: body,
        signatureKey: key,
        providedSignature: sig,
      }),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = computeSquareSignature(url, body, key);
    expect(
      verifySquareSignature({
        notificationUrl: url,
        rawBody: body + "x",
        signatureKey: key,
        providedSignature: sig,
      }),
    ).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(
      verifySquareSignature({
        notificationUrl: url,
        rawBody: body,
        signatureKey: key,
        providedSignature: null,
      }),
    ).toBe(false);
  });

  it("extracts the event id for idempotency", () => {
    expect(squareEventId({ event_id: "evt_9" })).toBe("evt_9");
    expect(squareEventId({ id: "fallback" })).toBe("fallback");
    expect(squareEventId({})).toBeNull();
  });
});

describe("Square payment status mapping (§10.1)", () => {
  it("maps Square statuses onto the internal payment_status enum", () => {
    expect(mapSquarePaymentStatus("COMPLETED")).toBe("confirmed");
    expect(mapSquarePaymentStatus("FAILED")).toBe("failed");
    expect(mapSquarePaymentStatus("CANCELED")).toBe("cancelled");
    expect(mapSquarePaymentStatus("APPROVED")).toBe("pending");
    expect(mapSquarePaymentStatus("PENDING")).toBe("pending");
  });

  it("treats unknown/missing statuses as pending, never confirmed", () => {
    expect(mapSquarePaymentStatus("SOMETHING_NEW")).toBe("pending");
    expect(mapSquarePaymentStatus(null)).toBe("pending");
    expect(mapSquarePaymentStatus(undefined)).toBe("pending");
  });

  it("recognizes payment webhook event types", () => {
    expect(isSquarePaymentEvent("payment.created")).toBe(true);
    expect(isSquarePaymentEvent("payment.updated")).toBe(true);
    expect(isSquarePaymentEvent("refund.updated")).toBe(false);
    expect(isSquarePaymentEvent(null)).toBe(false);
  });
});

describe("Square payment normalization", () => {
  const payment = {
    id: "sq_pay_1",
    order_id: "sq_order_1",
    customer_id: "sq_cust_1",
    status: "COMPLETED",
    amount_money: { amount: 12500, currency: "CAD" },
    source_type: "CARD",
    reference_id: "6f1d3f0a-0000-0000-0000-000000000000",
  };

  it("normalizes an API/webhook payment object", () => {
    expect(normalizeSquarePayment(payment)).toEqual({
      squarePaymentId: "sq_pay_1",
      squareOrderId: "sq_order_1",
      squareCustomerId: "sq_cust_1",
      status: "COMPLETED",
      amountCents: 12500,
      currency: "CAD",
      sourceType: "CARD",
      referenceId: "6f1d3f0a-0000-0000-0000-000000000000",
    });
  });

  it("tolerates missing optional fields", () => {
    expect(normalizeSquarePayment({ id: "p1" })).toEqual({
      squarePaymentId: "p1",
      squareOrderId: null,
      squareCustomerId: null,
      status: null,
      amountCents: null,
      currency: null,
      sourceType: null,
      referenceId: null,
    });
  });

  it("rejects objects without an id", () => {
    expect(normalizeSquarePayment({})).toBeNull();
    expect(normalizeSquarePayment(null)).toBeNull();
    expect(normalizeSquarePayment("nope")).toBeNull();
  });

  it("extracts the payment from a webhook envelope", () => {
    const envelope = {
      merchant_id: "M1",
      type: "payment.updated",
      event_id: "evt_1",
      data: { type: "payment", id: "sq_pay_1", object: { payment } },
    };
    expect(extractSquarePaymentFromEvent(envelope)?.squarePaymentId).toBe(
      "sq_pay_1",
    );
    expect(extractSquarePaymentFromEvent({ data: {} })).toBeNull();
    expect(extractSquarePaymentFromEvent({})).toBeNull();
  });
});

describe("Square error messages", () => {
  it("maps decline codes to actionable front-desk messages", () => {
    expect(
      squareErrorMessage([{ category: "PAYMENT_METHOD_ERROR", code: "CARD_DECLINED" }]),
    ).toMatch(/declined/i);
    expect(
      squareErrorMessage([{ category: "PAYMENT_METHOD_ERROR", code: "CVV_FAILURE" }]),
    ).toMatch(/security code/i);
    expect(
      squareErrorMessage([{ category: "PAYMENT_METHOD_ERROR", code: "INSUFFICIENT_FUNDS" }]),
    ).toMatch(/insufficient/i);
  });

  it("falls back by category, then detail, then a generic message", () => {
    expect(
      squareErrorMessage([{ category: "AUTHENTICATION_ERROR", code: "UNAUTHORIZED" }]),
    ).toMatch(/credentials/i);
    expect(
      squareErrorMessage([{ code: "WEIRD", detail: "Something specific." }]),
    ).toBe("Something specific.");
    expect(squareErrorMessage([])).toMatch(/failed/i);
    expect(squareErrorMessage(undefined)).toMatch(/failed/i);
  });
});
