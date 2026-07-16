import { describe, expect, it } from "vitest";
import {
  canConsumeSession,
  computePackageBalance,
} from "@/lib/domain/package-ledger";

describe("package session ledger (§FR-PKG-002/003)", () => {
  it("remaining = total - net consumed", () => {
    const b = computePackageBalance(10, [
      { delta: -1 },
      { delta: -1 },
      { delta: -1 },
    ]);
    expect(b.used).toBe(3);
    expect(b.remaining).toBe(7);
    expect(b.status).toBe("active");
  });

  it("reversals restore sessions", () => {
    const b = computePackageBalance(5, [
      { delta: -1 },
      { delta: -1 },
      { delta: +1 }, // authorized reversal
    ]);
    expect(b.used).toBe(1);
    expect(b.remaining).toBe(4);
  });

  it("marks exhausted at zero", () => {
    const b = computePackageBalance(2, [{ delta: -1 }, { delta: -1 }]);
    expect(b.remaining).toBe(0);
    expect(b.status).toBe("exhausted");
  });

  it("blocks consuming beyond the balance", () => {
    const ledger = [{ delta: -1 }, { delta: -1 }];
    expect(canConsumeSession(2, ledger).ok).toBe(false);
    expect(canConsumeSession(3, ledger).ok).toBe(true);
  });
});
