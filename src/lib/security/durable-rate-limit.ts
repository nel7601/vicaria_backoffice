import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import type { RateDecision } from "./rate-limit";

/**
 * Rate limiting that holds across instances.
 *
 * The in-memory limiter counts per process. On Vercel that means the real cap
 * is the configured one times however many instances are warm — fine for a
 * courtesy limit, not fine when what it guards is the model provider's bill.
 *
 * The counter lives in Postgres and is incremented by a single upsert, so two
 * instances racing on the same key serialise on the primary key instead of
 * losing a count the way read-then-write would.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateDecision> {
  try {
    const db = getDb();
    const rows = await db.execute<{
      allowed: boolean;
      remaining: number;
      reset_at: Date;
    }>(
      sql`select * from app.check_rate_limit(${key}, ${limit}, ${windowSeconds})`,
    );

    const row = Array.isArray(rows) ? rows[0] : (rows as { rows?: unknown[] }).rows?.[0];
    if (!row) return permissive(limit, windowSeconds);

    const decision = row as { allowed: boolean; remaining: number; reset_at: Date };
    return {
      allowed: decision.allowed,
      remaining: Number(decision.remaining),
      resetAt: new Date(decision.reset_at).getTime(),
    };
  } catch {
    // A limiter that fails closed would take the assistant down with the
    // database's first hiccup, to protect against a cost that has not happened
    // yet. Failing open is the lesser harm, and the provider's own limits are
    // still underneath.
    return permissive(limit, windowSeconds);
  }
}

function permissive(limit: number, windowSeconds: number): RateDecision {
  return {
    allowed: true,
    remaining: limit,
    resetAt: Date.now() + windowSeconds * 1000,
  };
}
