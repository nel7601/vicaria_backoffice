/**
 * Patient domain logic (spec §6.2).
 * Pure functions: normalization, patient-number formatting and duplicate
 * detection (FR-PAT-001/002). No I/O, fully unit-tested.
 */

/** Trim + lowercase email; empty becomes null. */
export function normalizeEmail(email?: string | null): string | null {
  const v = (email ?? "").trim().toLowerCase();
  return v.length > 0 ? v : null;
}

/** Collapse whitespace in a name; empty becomes null. */
export function normalizeName(name?: string | null): string | null {
  const v = (name ?? "").trim().replace(/\s+/g, " ");
  return v.length > 0 ? v : null;
}

/**
 * Normalize a phone number to E.164 for Canada/US defaults (A-05).
 * - Strips spaces, dashes, parentheses and dots.
 * - Keeps an existing leading "+".
 * - 10 digits → +1XXXXXXXXXX; 11 digits starting with 1 → +1XXXXXXXXXX.
 * Returns null when it cannot produce a plausible E.164 number.
 */
export function normalizePhone(phone?: string | null): string | null {
  const raw = (phone ?? "").trim();
  if (!raw) return null;

  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 0) return null;

  if (hasPlus) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function formatPatientNumber(sequence: number): string {
  return `P-${String(sequence).padStart(4, "0")}`;
}

export interface DuplicateCandidate {
  id: string;
  email?: string | null;
  phoneE164?: string | null;
  legalFirstName?: string | null;
  legalLastName?: string | null;
  dateOfBirth?: string | null;
}

export interface DuplicateQuery {
  email?: string | null;
  phoneE164?: string | null;
  legalFirstName?: string | null;
  legalLastName?: string | null;
  dateOfBirth?: string | null;
}

export type DuplicateReason = "email" | "phone" | "name_dob";

export interface DuplicateMatch {
  id: string;
  reasons: DuplicateReason[];
  strength: "strong" | "possible";
}

/**
 * Find potential duplicates (FR-PAT-002). Compares on normalized email, phone
 * and the (name + DOB) combination. Email or phone match = strong; name+DOB
 * match alone = strong; a partial name match without DOB is not reported.
 */
export function findDuplicates(
  query: DuplicateQuery,
  candidates: DuplicateCandidate[],
): DuplicateMatch[] {
  const qEmail = normalizeEmail(query.email);
  const qPhone = normalizePhone(query.phoneE164);
  const qFirst = normalizeName(query.legalFirstName)?.toLowerCase();
  const qLast = normalizeName(query.legalLastName)?.toLowerCase();
  const qDob = query.dateOfBirth || null;

  const matches: DuplicateMatch[] = [];

  for (const c of candidates) {
    const reasons: DuplicateReason[] = [];

    if (qEmail && normalizeEmail(c.email) === qEmail) reasons.push("email");
    if (qPhone && normalizePhone(c.phoneE164) === qPhone) reasons.push("phone");

    const cFirst = normalizeName(c.legalFirstName)?.toLowerCase();
    const cLast = normalizeName(c.legalLastName)?.toLowerCase();
    if (
      qFirst &&
      qLast &&
      qDob &&
      cFirst === qFirst &&
      cLast === qLast &&
      c.dateOfBirth === qDob
    ) {
      reasons.push("name_dob");
    }

    if (reasons.length > 0) {
      matches.push({ id: c.id, reasons, strength: "strong" });
    }
  }

  return matches;
}
