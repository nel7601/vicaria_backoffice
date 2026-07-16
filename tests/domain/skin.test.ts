import { describe, expect, it } from "vitest";
import { lesionLineCents, suggestedProcedureTotalCents } from "@/lib/domain/skin";

describe("skin lesion pricing (§FR-SKIN-002)", () => {
  it("applies complexity multipliers", () => {
    expect(lesionLineCents({ quantity: 1, unitPriceCents: 10000, complexity: "simple" })).toBe(10000);
    expect(lesionLineCents({ quantity: 1, unitPriceCents: 10000, complexity: "moderate" })).toBe(15000);
    expect(lesionLineCents({ quantity: 2, unitPriceCents: 10000, complexity: "complex" })).toBe(40000);
  });

  it("sums a procedure total", () => {
    const total = suggestedProcedureTotalCents([
      { quantity: 2, unitPriceCents: 5000, complexity: "simple" }, // 10000
      { quantity: 1, unitPriceCents: 8000, complexity: "moderate" }, // 12000
    ]);
    expect(total).toBe(22000);
  });

  it("ignores fractional/negative quantities safely", () => {
    expect(lesionLineCents({ quantity: -3, unitPriceCents: 5000, complexity: "simple" })).toBe(0);
  });
});
