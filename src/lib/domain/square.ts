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

/** Webhook event types that carry a Square Payment object. */
export function isSquarePaymentEvent(eventType: string | null | undefined): boolean {
  return eventType === "payment.created" || eventType === "payment.updated";
}

/**
 * Map a Square payment status to the internal payment_status enum.
 * APPROVED means authorized but not yet captured (we always autocomplete, but
 * a webhook can still observe the intermediate state) — treat as pending.
 */
export function mapSquarePaymentStatus(
  status: string | null | undefined,
): "pending" | "confirmed" | "failed" | "cancelled" {
  switch (status) {
    case "COMPLETED":
      return "confirmed";
    case "FAILED":
      return "failed";
    case "CANCELED":
      return "cancelled";
    case "APPROVED":
    case "PENDING":
    default:
      return "pending";
  }
}

export interface SquarePaymentSummary {
  squarePaymentId: string;
  squareOrderId: string | null;
  squareCustomerId: string | null;
  status: string | null;
  amountCents: number | null;
  currency: string | null;
  sourceType: string | null;
  /** Our reference_id — set to the invoice id by the checkout action. */
  referenceId: string | null;
  /** Set by Square when the payment was taken on a Terminal device. */
  terminalCheckoutId: string | null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Normalize a raw Square Payment object (API response or webhook). */
export function normalizeSquarePayment(obj: unknown): SquarePaymentSummary | null {
  if (!obj || typeof obj !== "object") return null;
  const p = obj as Record<string, unknown>;
  const id = asString(p.id);
  if (!id) return null;
  const money =
    p.amount_money && typeof p.amount_money === "object"
      ? (p.amount_money as Record<string, unknown>)
      : null;
  return {
    squarePaymentId: id,
    squareOrderId: asString(p.order_id),
    squareCustomerId: asString(p.customer_id),
    status: asString(p.status),
    amountCents: typeof money?.amount === "number" ? money.amount : null,
    currency: asString(money?.currency),
    sourceType: asString(p.source_type),
    referenceId: asString(p.reference_id),
    terminalCheckoutId: asString(p.terminal_checkout_id),
  };
}

/**
 * Extract the Payment object from a `payment.created` / `payment.updated`
 * webhook envelope: { type, event_id, data: { object: { payment: {...} } } }.
 */
export function extractSquarePaymentFromEvent(
  payload: unknown,
): SquarePaymentSummary | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as Record<string, unknown>).data;
  if (!data || typeof data !== "object") return null;
  const object = (data as Record<string, unknown>).object;
  if (!object || typeof object !== "object") return null;
  return normalizeSquarePayment((object as Record<string, unknown>).payment);
}

/** Webhook event types that carry a Terminal checkout object. */
export function isSquareTerminalEvent(
  eventType: string | null | undefined,
): boolean {
  return (
    eventType === "terminal.checkout.created" ||
    eventType === "terminal.checkout.updated"
  );
}

/**
 * Map a Terminal checkout status onto the internal payment_status enum.
 * PENDING/IN_PROGRESS/CANCEL_REQUESTED are all still in flight on the device.
 * A timed-out or dismissed checkout arrives as CANCELED.
 */
export function mapTerminalCheckoutStatus(
  status: string | null | undefined,
): "pending" | "confirmed" | "cancelled" {
  switch (status) {
    case "COMPLETED":
      return "confirmed";
    case "CANCELED":
      return "cancelled";
    default:
      return "pending";
  }
}

export interface TerminalCheckoutSummary {
  checkoutId: string;
  status: string | null;
  amountCents: number | null;
  currency: string | null;
  /** Our reference_id — set to the invoice id when the checkout is pushed. */
  referenceId: string | null;
  /** Square payment ids produced by the checkout (set when COMPLETED). */
  paymentIds: string[];
}

/** Normalize a raw Terminal checkout object (API response or webhook). */
export function normalizeTerminalCheckout(
  obj: unknown,
): TerminalCheckoutSummary | null {
  if (!obj || typeof obj !== "object") return null;
  const c = obj as Record<string, unknown>;
  const id = asString(c.id);
  if (!id) return null;
  const money =
    c.amount_money && typeof c.amount_money === "object"
      ? (c.amount_money as Record<string, unknown>)
      : null;
  const paymentIds = Array.isArray(c.payment_ids)
    ? c.payment_ids.filter((v): v is string => typeof v === "string")
    : [];
  return {
    checkoutId: id,
    status: asString(c.status),
    amountCents: typeof money?.amount === "number" ? money.amount : null,
    currency: asString(money?.currency),
    referenceId: asString(c.reference_id),
    paymentIds,
  };
}

/**
 * Extract the checkout from a `terminal.checkout.*` webhook envelope:
 * { type, event_id, data: { object: { checkout: {...} } } }.
 */
export function extractTerminalCheckoutFromEvent(
  payload: unknown,
): TerminalCheckoutSummary | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as Record<string, unknown>).data;
  if (!data || typeof data !== "object") return null;
  const object = (data as Record<string, unknown>).object;
  if (!object || typeof object !== "object") return null;
  return normalizeTerminalCheckout(
    (object as Record<string, unknown>).checkout,
  );
}

export interface SquareApiError {
  category?: string;
  code?: string;
  detail?: string;
}

/** Card-decline codes mapped to messages the front desk can act on. */
const SQUARE_ERROR_MESSAGES: Record<string, string> = {
  CARD_DECLINED: "The card was declined. Ask for another card.",
  CARD_DECLINED_CALL_ISSUER: "Declined — the cardholder must call their bank.",
  CARD_DECLINED_VERIFICATION_REQUIRED:
    "Declined — additional verification is required by the issuer.",
  CVV_FAILURE: "The security code (CVV) does not match.",
  ADDRESS_VERIFICATION_FAILURE: "The postal code does not match the card.",
  INVALID_EXPIRATION: "The expiration date is invalid.",
  CARD_EXPIRED: "The card is expired.",
  INSUFFICIENT_FUNDS: "Insufficient funds on the card.",
  CARD_NOT_SUPPORTED: "This card type is not supported.",
  INVALID_CARD: "The card number is invalid.",
  GENERIC_DECLINE: "The card was declined. Ask for another card.",
  TRANSACTION_LIMIT: "The amount is outside the allowed transaction limits.",
  IDEMPOTENCY_KEY_REUSED:
    "This payment was already submitted — refresh the invoice before retrying.",
};

/** Human-friendly message for a Square error list (never leaks raw payloads). */
export function squareErrorMessage(errors: SquareApiError[] | undefined): string {
  const first = errors?.[0];
  if (!first) return "Card payment failed. Try again.";
  if (first.code && SQUARE_ERROR_MESSAGES[first.code]) {
    return SQUARE_ERROR_MESSAGES[first.code];
  }
  if (first.category === "PAYMENT_METHOD_ERROR") {
    return "The card was not accepted. Ask for another card.";
  }
  if (first.category === "AUTHENTICATION_ERROR") {
    return "Square credentials are invalid — check the integration settings.";
  }
  return first.detail || "Card payment failed. Try again.";
}
