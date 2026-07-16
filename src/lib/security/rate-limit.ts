/**
 * Rate limiting (spec SEC-07). Fixed-window counter.
 *
 * The in-memory limiter is a first layer suitable for a single instance and
 * for local/dev. Production behind multiple serverless instances should back
 * this with a durable store (e.g. Upstash/Redis); the pure `fixedWindow`
 * function is storage-agnostic and unit-tested.
 */

export interface WindowState {
  count: number;
  resetAt: number; // epoch ms
}

export interface RateDecision {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/** Pure fixed-window check; returns the decision and the next state. */
export function fixedWindow(
  state: WindowState | undefined,
  now: number,
  limit: number,
  windowMs: number,
): { decision: RateDecision; state: WindowState } {
  if (!state || now >= state.resetAt) {
    const next: WindowState = { count: 1, resetAt: now + windowMs };
    return {
      decision: { allowed: true, remaining: limit - 1, resetAt: next.resetAt },
      state: next,
    };
  }
  const count = state.count + 1;
  const allowed = count <= limit;
  return {
    decision: {
      allowed,
      remaining: Math.max(0, limit - count),
      resetAt: state.resetAt,
    },
    state: { count, resetAt: state.resetAt },
  };
}

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, WindowState>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  check(key: string): RateDecision {
    const { decision, state } = fixedWindow(
      this.buckets.get(key),
      this.now(),
      this.limit,
      this.windowMs,
    );
    this.buckets.set(key, state);
    return decision;
  }
}

/** Shared limiter for webhook endpoints: 60 requests/minute per key. */
export const webhookLimiter = new InMemoryRateLimiter(60, 60_000);
