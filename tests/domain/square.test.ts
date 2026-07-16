import { describe, expect, it } from "vitest";
import {
  computeSquareSignature,
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
