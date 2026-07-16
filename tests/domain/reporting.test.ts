import { describe, expect, it } from "vitest";
import {
  agingBucket,
  buildAging,
  suppressSmallGroups,
  sumByKey,
} from "@/lib/domain/reporting";

describe("aging buckets (FIN-02)", () => {
  it("maps days to buckets", () => {
    expect(agingBucket(0)).toBe("0-30");
    expect(agingBucket(30)).toBe("0-30");
    expect(agingBucket(31)).toBe("31-60");
    expect(agingBucket(75)).toBe("61-90");
    expect(agingBucket(120)).toBe("90+");
  });

  it("aggregates balances by bucket", () => {
    const now = new Date("2026-07-16T00:00:00Z");
    const totals = buildAging(
      [
        { balanceCents: 1000, referenceDate: new Date("2026-07-10T00:00:00Z") }, // 6d
        { balanceCents: 2000, referenceDate: new Date("2026-06-01T00:00:00Z") }, // 45d
        { balanceCents: 500, referenceDate: new Date("2026-01-01T00:00:00Z") }, // >90
        { balanceCents: 0, referenceDate: new Date("2026-01-01T00:00:00Z") }, // ignored
      ],
      now,
    );
    expect(totals["0-30"]).toBe(1000);
    expect(totals["31-60"]).toBe(2000);
    expect(totals["90+"]).toBe(500);
  });
});

describe("small-group suppression (§11.1)", () => {
  it("drops groups below threshold", () => {
    const { visible, suppressedGroups, suppressedCount } = suppressSmallGroups(
      [
        { key: "instagram", count: 12 },
        { key: "referral", count: 3 },
        { key: "walk-in", count: 1 },
      ],
      5,
    );
    expect(visible.map((v) => v.key)).toEqual(["instagram"]);
    expect(suppressedGroups).toBe(2);
    expect(suppressedCount).toBe(4);
  });
});

describe("sumByKey (FIN-03)", () => {
  it("sums values grouped by key", () => {
    const rows = [
      { method: "cash", amount: 100 },
      { method: "cash", amount: 50 },
      { method: "e_transfer", amount: 200 },
    ];
    const result = sumByKey(rows, (r) => r.method, (r) => r.amount);
    expect(result).toContainEqual({ key: "cash", total: 150 });
    expect(result).toContainEqual({ key: "e_transfer", total: 200 });
  });
});
