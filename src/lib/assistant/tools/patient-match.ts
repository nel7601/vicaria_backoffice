/**
 * Normalising and scoring a spoken name (assistant plan §4.4).
 *
 * Pure so the matching rules can be tested against the mistakes speech
 * recognition actually makes, without a database.
 */

/**
 * Fold a spoken name into something comparable: lowercase, no accents, no
 * punctuation, single spaces.
 *
 * Accents are stripped on both sides rather than in SQL because Postgres
 * `unaccent` is not immutable and so cannot back an index; trigram similarity
 * already tolerates the difference, and folding here keeps the two sides
 * consistent.
 */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A patient number said out loud: digits and letters, no separators. */
export function normalizeNumber(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Does this look like a patient number rather than a name?
 *
 * Only when it is mostly digits. "P-1042" is a number; "Ana" is not, and
 * neither is a name that happens to contain one.
 */
export function looksLikeNumber(value: string): boolean {
  const cleaned = normalizeNumber(value);
  if (cleaned.length < 2) return false;
  const digits = cleaned.replace(/[^0-9]/g, "").length;
  return digits >= 2 && digits / cleaned.length >= 0.5;
}

/**
 * Confidence that two names are the same person, 0..1.
 *
 * Trigram similarity alone is too generous with short names — "Ana" and "Ann"
 * score highly and are different people — so an exact match after folding is
 * the only thing that earns full confidence.
 */
export function nameScore(query: string, candidate: string): number {
  const a = normalizeName(query);
  const b = normalizeName(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;

  // A spoken first name against a full name: "Cuco" vs "Cuco Pérez".
  const parts = b.split(" ").filter(Boolean);
  if (parts.includes(a)) return 0.9;

  // A single spoken word has to be compared with each part of the name as
  // well as the whole. "Prya" against "priya sharma" scores badly as a whole
  // — the surname dilutes it — while against "priya" it is the near miss it
  // actually is, which is the exact case speech recognition produces.
  const whole = trigramSimilarity(a, b);
  if (a.includes(" ")) return whole;

  const bestPart = parts.reduce(
    (best, part) => Math.max(best, trigramSimilarity(a, part)),
    0,
  );
  // Slightly discounted: matching one part is weaker evidence than matching
  // the whole name, and must stay below the confident-match threshold so a
  // near miss still asks rather than assumes.
  return Math.max(whole, bestPart * 0.9);
}

/** Jaccard similarity over trigrams — the same measure pg_trgm uses. */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    set.add(padded.slice(i, i + 3));
  }
  return set;
}

/**
 * How sure we must be before a single candidate counts as resolved.
 *
 * Below this the tool reports candidates and lets the user choose. The cost is
 * asymmetric: an extra question is mildly annoying, acting on the wrong
 * patient is not.
 */
export const CONFIDENT_MATCH = 0.85;

/** Anything weaker than this is not worth showing as a candidate at all. */
export const MINIMUM_CANDIDATE = 0.3;

/**
 * Decide the outcome of a match given scored candidates.
 *
 * "One clear winner" requires both a confident score and a clear gap to the
 * runner-up: two patients called "Ana García" must always be disambiguated by
 * a person, however high both score.
 */
export function classifyMatches<T extends { score: number }>(
  scored: T[],
): { status: "none" | "one" | "many"; matches: T[] } {
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const viable = ranked.filter((c) => c.score >= MINIMUM_CANDIDATE);

  if (!viable.length) return { status: "none", matches: [] };

  const [best, second] = viable;
  const clearWinner =
    best.score >= CONFIDENT_MATCH && (!second || best.score - second.score >= 0.15);

  return clearWinner
    ? { status: "one", matches: [best] }
    : { status: "many", matches: viable.slice(0, 5) };
}
