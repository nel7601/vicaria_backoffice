import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Square webhook signature verification (spec §10.1).
 * Square signs with HMAC-SHA256 over (notificationUrl + rawBody) using the
 * webhook signature key, base64-encoded. Verification must be timing-safe.
 * Pure functions so the logic is unit-tested without a live endpoint.
 */

export function computeSquareSignature(
  notificationUrl: string,
  rawBody: string,
  signatureKey: string,
): string {
  return createHmac("sha256", signatureKey)
    .update(notificationUrl + rawBody)
    .digest("base64");
}

export function verifySquareSignature(params: {
  notificationUrl: string;
  rawBody: string;
  signatureKey: string;
  providedSignature: string | null;
}): boolean {
  if (!params.providedSignature) return false;
  const expected = computeSquareSignature(
    params.notificationUrl,
    params.rawBody,
    params.signatureKey,
  );
  const a = Buffer.from(expected);
  const b = Buffer.from(params.providedSignature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Extract the canonical event id used for idempotency (§10.1). */
export function squareEventId(payload: unknown): string | null {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (typeof p.event_id === "string") return p.event_id;
    if (typeof p.id === "string") return p.id;
  }
  return null;
}
