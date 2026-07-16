/**
 * Money helpers. All monetary values are integer cents (spec §8.1) to avoid
 * floating-point drift. Currency is CAD for the MVP (A-05).
 */

export function formatCents(
  cents: number,
  opts: { currency?: string; locale?: string } = {},
): string {
  const { currency = "CAD", locale = "en-CA" } = opts;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(cents / 100);
}

/** Rounds to the nearest cent using banker-safe half-up on integers. */
export function taxOnCents(baseCents: number, rateBps: number): number {
  // rateBps = basis points (1300 = 13%). Round half up.
  return Math.round((baseCents * rateBps) / 10000);
}

export function sumCents(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
