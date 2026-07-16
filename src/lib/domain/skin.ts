/**
 * Skin procedure pricing (spec §6.5, FR-SKIN-002).
 * Suggested totals are computed from lesion units with a complexity multiplier;
 * the actual invoice still snapshots frozen prices. Pure + tested.
 */

export type LesionComplexity = "simple" | "moderate" | "complex";

/** Complexity multipliers applied to a lesion's unit price (basis: 1.0x). */
export const COMPLEXITY_MULTIPLIER: Record<LesionComplexity, number> = {
  simple: 1,
  moderate: 1.5,
  complex: 2,
};

export interface LesionPricingInput {
  quantity: number;
  unitPriceCents: number;
  complexity: LesionComplexity;
}

/** Price for one lesion line: quantity × unit × complexity, rounded to cents. */
export function lesionLineCents(l: LesionPricingInput): number {
  const qty = Math.max(0, Math.floor(l.quantity));
  const mult = COMPLEXITY_MULTIPLIER[l.complexity];
  return Math.round(qty * l.unitPriceCents * mult);
}

/** Suggested total across all lesions in a procedure (FR-SKIN-002). */
export function suggestedProcedureTotalCents(
  lesions: LesionPricingInput[],
): number {
  return lesions.reduce((sum, l) => sum + lesionLineCents(l), 0);
}
