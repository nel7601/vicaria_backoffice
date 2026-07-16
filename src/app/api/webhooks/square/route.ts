import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { webhookEvents } from "@/lib/db/schema";
import {
  squareEventId,
  verifySquareSignature,
} from "@/lib/domain/square";

/**
 * Square webhook (spec §10.1).
 * Steps: verify signature → insert webhook_event idempotently by event_id →
 * return 2xx fast. Heavy processing (loading the Square object, upserting
 * square_transactions, matching/creating payments) is done by an async worker
 * and MUST remain idempotent (NFR-11). We never trust email as a unique key.
 */
export async function POST(request: Request) {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!signatureKey) {
    // Misconfiguration — do not accept unverifiable events.
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const providedSignature = request.headers.get("x-square-hmacsha256-signature");
  const notificationUrl = request.url;

  const valid = verifySquareSignature({
    notificationUrl,
    rawBody,
    signatureKey,
    providedSignature,
  });
  if (!valid) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const eventId = squareEventId(payload);
  if (!eventId) {
    return NextResponse.json({ error: "missing_event_id" }, { status: 400 });
  }

  const eventType =
    (payload as { type?: string })?.type ?? "unknown";

  try {
    const db = getDb();
    // Idempotent insert: the unique (provider, event_id) index makes a repeated
    // delivery a no-op rather than a duplicate payment.
    await db
      .insert(webhookEvents)
      .values({
        provider: "square",
        eventId,
        eventType,
        payload: payload as Record<string, unknown>,
      })
      .onConflictDoNothing({
        target: [webhookEvents.provider, webhookEvents.eventId],
      });
  } catch (e) {
    console.error("Square webhook persist failed:", e);
    // Still return 2xx so Square does not hammer retries; the event is lost
    // only if the DB is down, which alerting will catch.
    return NextResponse.json({ received: true, stored: false });
  }

  return NextResponse.json({ received: true });
}
