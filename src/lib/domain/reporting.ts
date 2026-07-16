/**
 * Reporting domain logic (spec §11, §11.1). Pure + tested.
 * Aging buckets, small-group suppression and simple aggregations.
 */

export type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";

export const AGING_BUCKETS: AgingBucket[] = ["0-30", "31-60", "61-90", "90+"];

/** Bucket a number of days outstanding into the FIN-02 ranges. */
export function agingBucket(daysOutstanding: number): AgingBucket {
  if (daysOutstanding <= 30) return "0-30";
  if (daysOutstanding <= 60) return "31-60";
  if (daysOutstanding <= 90) return "61-90";
  return "90+";
}

export interface OutstandingInvoice {
  balanceCents: number;
  referenceDate: Date; // due date, or issue date when no due date
}

/** Aggregate outstanding balances into aging buckets (FIN-02). */
export function buildAging(
  invoices: OutstandingInvoice[],
  now: Date,
): Record<AgingBucket, number> {
  const totals: Record<AgingBucket, number> = {
    "0-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
  };
  for (const inv of invoices) {
    if (inv.balanceCents <= 0) continue;
    const days = Math.floor(
      (now.getTime() - inv.referenceDate.getTime()) / (24 * 60 * 60 * 1000),
    );
    totals[agingBucket(Math.max(0, days))] += inv.balanceCents;
  }
  return totals;
}

/**
 * Suppress small groups to prevent re-identification (§11.1). Rows whose count
 * is below the threshold are dropped and reported as a suppressed aggregate.
 */
export interface CountRow {
  key: string;
  count: number;
  [k: string]: unknown;
}

export function suppressSmallGroups<T extends CountRow>(
  rows: T[],
  threshold = 5,
): { visible: T[]; suppressedGroups: number; suppressedCount: number } {
  const visible: T[] = [];
  let suppressedGroups = 0;
  let suppressedCount = 0;
  for (const r of rows) {
    if (r.count < threshold) {
      suppressedGroups += 1;
      suppressedCount += r.count;
    } else {
      visible.push(r);
    }
  }
  return { visible, suppressedGroups, suppressedCount };
}

/** Sum values grouped by a key (e.g. payment method totals, FIN-03). */
export function sumByKey<T>(
  items: T[],
  keyFn: (item: T) => string,
  valueFn: (item: T) => number,
): { key: string; total: number }[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const k = keyFn(item);
    map.set(k, (map.get(k) ?? 0) + valueFn(item));
  }
  return [...map.entries()].map(([key, total]) => ({ key, total }));
}
