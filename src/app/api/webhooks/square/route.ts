import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { webhookEvents } from "@/lib/db/schema";
import {
  squareEventId,
  verifySquareSignature,
} from "@/lib/domain/square";
import { processSquareWebhookEvent } from "@/lib/square/process-webhook";
import { webhookLimiter } from "@/lib/security/rate-limit";

/**
 * Square webhook (spec §10.1).
 * Steps: verify signature → insert webhook_event idempotently by event_id →
 * process (upsert square_transactions, match/create payments) → 2xx.
 * Processing is idempotent (NFR-11), so Square's redelivery on non-2xx is our
 * retry mechanism. We never trust email as a unique key.
 */
export async function POST(request: Request) {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!signatureKey) {
    // Misconfiguration — do not accept unverifiable events.
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  // SEC-07: basic rate limiting per source IP.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!webhookLimiter.check(`square:${ip}`).allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
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

  const db = getDb();
  try {
    // Idempotent insert: the unique (provider, event_id) index makes a repeated
    // delivery a no-op rather than a duplicate payment.
    const inserted = await db
      .insert(webhookEvents)
      .values({
        provider: "square",
        eventId,
        eventType,
        payload: payload as Record<string, unknown>,
      })
      .onConflictDoNothing({
        target: [webhookEvents.provider, webhookEvents.eventId],
      })
      .returning({ id: webhookEvents.id });

    // A redelivery of an already-processed event is a no-op; a redelivery of
    // a stored-but-unprocessed event (previous processing crashed) retries.
    let shouldProcess = inserted.length > 0;
    if (!shouldProcess) {
      const [existing] = await db
        .select({ processedAt: webhookEvents.processedAt })
        .from(webhookEvents)
        .where(
          and(
            eq(webhookEvents.provider, "square"),
            eq(webhookEvents.eventId, eventId),
          ),
        )
        .limit(1);
      shouldProcess = !!existing && existing.processedAt === null;
    }
    if (!shouldProcess) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  } catch (e) {
    console.error("Square webhook persist failed:", e);
    // Still return 2xx so Square does not hammer retries; the event is lost
    // only if the DB is down, which alerting will catch.
    return NextResponse.json({ received: true, stored: false });
  }

  try {
    await processSquareWebhookEvent(db, { eventId, eventType, payload });
  } catch (e) {
    console.error("Square webhook processing failed:", e);
    // Stored but unprocessed: return 5xx so Square redelivers and the
    // idempotent processor gets another chance.
    return NextResponse.json(
      { received: true, processed: false },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
