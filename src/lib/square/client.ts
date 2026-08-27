import { logger } from "@/lib/observability/logger";
import {
  normalizeSquarePayment,
  normalizeTerminalCheckout,
  squareErrorMessage,
  type SquareApiError,
  type SquarePaymentSummary,
  type TerminalCheckoutSummary,
} from "@/lib/domain/square";

/**
 * Server-side Square REST client (spec §10.1). Card data never touches this
 * server: the browser tokenizes with the Web Payments SDK and we only handle
 * the one-time source token. Never import this from client components.
 *
 * All mutating calls send an idempotency key (we use the id of our own DB row)
 * so a retried request can never charge or refund twice (NFR-11).
 */

/** Pinned API version — bump deliberately, reading Square's changelog. */
const SQUARE_VERSION = "2024-01-18";

export interface SquareConfig {
  accessToken: string;
  locationId: string;
  environment: "production" | "sandbox";
  baseUrl: string;
  /** Paired Square Terminal device id — null when no POS is configured. */
  terminalDeviceId: string | null;
}

/** Read config from env; null when the integration is not configured. */
export function getSquareConfig(): SquareConfig | null {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  // One location id shared with the client-side SDK (NEXT_PUBLIC_).
  const locationId =
    process.env.SQUARE_LOCATION_ID ?? process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  if (!accessToken || !locationId) return null;
  const environment =
    process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox";
  return {
    accessToken,
    locationId,
    environment,
    baseUrl:
      environment === "production"
        ? "https://connect.squareup.com"
        : "https://connect.squareupsandbox.com",
    terminalDeviceId: process.env.SQUARE_TERMINAL_DEVICE_ID || null,
  };
}

export type SquareResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; errors?: SquareApiError[] };

async function squareFetch(
  config: SquareConfig,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<SquareResult<Record<string, unknown>>> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch (e) {
    logger.error("square.request_failed", {
      path,
      reason: e instanceof Error ? e.message : "network",
    });
    return {
      ok: false,
      error: "Could not reach Square. Check the connection and try again.",
    };
  }

  let json: Record<string, unknown> = {};
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    // Non-JSON body (rare); fall through with the HTTP status only.
  }

  if (!response.ok) {
    const errors = (json.errors ?? []) as SquareApiError[];
    logger.warn("square.api_error", {
      path,
      status: response.status,
      codes: errors.map((e) => e.code),
    });
    return { ok: false, error: squareErrorMessage(errors), errors };
  }
  return { ok: true, value: json };
}

/**
 * Charge a tokenized card (POST /v2/payments, autocomplete).
 * `referenceId` carries our invoice id so webhooks/reconciliation can match
 * the transaction even if our local record was lost mid-flight.
 */
export async function createSquarePayment(params: {
  sourceId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  referenceId?: string;
  note?: string;
  verificationToken?: string;
}): Promise<SquareResult<SquarePaymentSummary>> {
  const config = getSquareConfig();
  if (!config) return { ok: false, error: "Square is not configured." };

  const result = await squareFetch(config, "POST", "/v2/payments", {
    source_id: params.sourceId,
    idempotency_key: params.idempotencyKey,
    amount_money: { amount: params.amountCents, currency: params.currency },
    location_id: config.locationId,
    autocomplete: true,
    reference_id: params.referenceId,
    note: params.note,
    verification_token: params.verificationToken,
  });
  if (!result.ok) return result;

  const payment = normalizeSquarePayment(result.value.payment);
  if (!payment) {
    return { ok: false, error: "Square returned an unexpected response." };
  }
  return { ok: true, value: payment };
}

/** Load a payment by Square id (GET /v2/payments/{id}). */
export async function getSquarePayment(
  squarePaymentId: string,
): Promise<SquareResult<SquarePaymentSummary>> {
  const config = getSquareConfig();
  if (!config) return { ok: false, error: "Square is not configured." };

  const result = await squareFetch(
    config,
    "GET",
    `/v2/payments/${encodeURIComponent(squarePaymentId)}`,
  );
  if (!result.ok) return result;
  const payment = normalizeSquarePayment(result.value.payment);
  if (!payment) {
    return { ok: false, error: "Square returned an unexpected response." };
  }
  return { ok: true, value: payment };
}

/**
 * Push a checkout to the paired Square Terminal (POST /v2/terminals/checkouts).
 * The device shows the amount and takes the card; completion arrives via the
 * terminal.checkout.updated webhook and via polling GetTerminalCheckout.
 * Tipping is disabled so the captured amount always equals the invoice charge.
 */
export async function createTerminalCheckout(params: {
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  referenceId?: string;
  note?: string;
}): Promise<SquareResult<TerminalCheckoutSummary>> {
  const config = getSquareConfig();
  if (!config) return { ok: false, error: "Square is not configured." };
  if (!config.terminalDeviceId) {
    return { ok: false, error: "No Square Terminal is configured." };
  }

  const result = await squareFetch(config, "POST", "/v2/terminals/checkouts", {
    idempotency_key: params.idempotencyKey,
    checkout: {
      amount_money: { amount: params.amountCents, currency: params.currency },
      device_options: {
        device_id: config.terminalDeviceId,
        skip_receipt_screen: false,
        tip_settings: { allow_tipping: false },
      },
      reference_id: params.referenceId,
      note: params.note,
    },
  });
  if (!result.ok) return result;

  const checkout = normalizeTerminalCheckout(result.value.checkout);
  if (!checkout) {
    return { ok: false, error: "Square returned an unexpected response." };
  }
  return { ok: true, value: checkout };
}

/** Load a Terminal checkout (GET /v2/terminals/checkouts/{id}). */
export async function getTerminalCheckout(
  checkoutId: string,
): Promise<SquareResult<TerminalCheckoutSummary>> {
  const config = getSquareConfig();
  if (!config) return { ok: false, error: "Square is not configured." };

  const result = await squareFetch(
    config,
    "GET",
    `/v2/terminals/checkouts/${encodeURIComponent(checkoutId)}`,
  );
  if (!result.ok) return result;
  const checkout = normalizeTerminalCheckout(result.value.checkout);
  if (!checkout) {
    return { ok: false, error: "Square returned an unexpected response." };
  }
  return { ok: true, value: checkout };
}

/** Cancel an in-flight Terminal checkout (POST .../{id}/cancel). */
export async function cancelTerminalCheckout(
  checkoutId: string,
): Promise<SquareResult<TerminalCheckoutSummary>> {
  const config = getSquareConfig();
  if (!config) return { ok: false, error: "Square is not configured." };

  const result = await squareFetch(
    config,
    "POST",
    `/v2/terminals/checkouts/${encodeURIComponent(checkoutId)}/cancel`,
  );
  if (!result.ok) return result;
  const checkout = normalizeTerminalCheckout(result.value.checkout);
  if (!checkout) {
    return { ok: false, error: "Square returned an unexpected response." };
  }
  return { ok: true, value: checkout };
}

/** Refund a captured payment, fully or partially (POST /v2/refunds). */
export async function createSquareRefund(params: {
  squarePaymentId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  reason?: string;
}): Promise<SquareResult<{ refundId: string; status: string | null }>> {
  const config = getSquareConfig();
  if (!config) return { ok: false, error: "Square is not configured." };

  const result = await squareFetch(config, "POST", "/v2/refunds", {
    idempotency_key: params.idempotencyKey,
    payment_id: params.squarePaymentId,
    amount_money: { amount: params.amountCents, currency: params.currency },
    // Square caps reason at 192 characters.
    reason: params.reason?.slice(0, 192),
  });
  if (!result.ok) return result;

  const refund = result.value.refund as Record<string, unknown> | undefined;
  const refundId = typeof refund?.id === "string" ? refund.id : null;
  if (!refundId) {
    return { ok: false, error: "Square returned an unexpected response." };
  }
  return {
    ok: true,
    value: {
      refundId,
      status: typeof refund?.status === "string" ? refund.status : null,
    },
  };
}
