/**
 * Package session ledger (spec §6.6, FR-PKG-002/003).
 *
 * Sessions remaining must always equal totalSessions minus the net consumption
 * recorded in the append-only usage ledger. A consumption is delta = -1; an
 * authorized reversal is delta = +1. This function is the single place that
 * computes balances, so the invariant is verifiable in tests.
 */

export interface UsageEntry {
  delta: number; // -1 consume, +1 reversal
}

export interface PackageBalance {
  total: number;
  used: number;
  remaining: number;
  status: "active" | "exhausted";
}

export function computePackageBalance(
  totalSessions: number,
  ledger: UsageEntry[],
): PackageBalance {
  const netConsumed = ledger.reduce((acc, e) => acc - e.delta, 0);
  const used = Math.max(0, netConsumed);
  const remaining = totalSessions - used;
  return {
    total: totalSessions,
    used,
    remaining,
    status: remaining <= 0 ? "exhausted" : "active",
  };
}

/** Guard before consuming a session (§FR-PKG-003). */
export function canConsumeSession(
  totalSessions: number,
  ledger: UsageEntry[],
): { ok: boolean; reason?: string } {
  const { remaining } = computePackageBalance(totalSessions, ledger);
  if (remaining <= 0) {
    return { ok: false, reason: "No sessions remaining in package." };
  }
  return { ok: true };
}
