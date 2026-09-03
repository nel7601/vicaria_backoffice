/**
 * "Where did I come from" for the back link (`?from=`).
 *
 * The clinical record is reached from a visit, an invoice, an appointment or
 * the patient list, and the way back differs every time. Rather than guess, the
 * link that brought you here says so, and this resolves that value into a
 * destination and a name for it.
 *
 * The value arrives in a URL, so it is untrusted: only same-origin absolute
 * paths are accepted. Anything else — a scheme, a protocol-relative `//host`,
 * a backslash — is discarded and the caller falls back to its own default,
 * which keeps `?from=` from becoming an open redirect.
 */

export interface ReturnTo {
  href: string;
  label: string;
}

const LABELS: [RegExp, string][] = [
  [/^\/patients\/[^/]+\/record(\/|$|\?)/, "Clinical record"],
  [/^\/patients\/[^/]+(\/|$|\?)/, "Patient profile"],
  [/^\/patients(\/|$|\?)/, "Patients"],
  [/^\/encounters\/[^/]+(\/|$|\?)/, "Encounter"],
  [/^\/encounters(\/|$|\?)/, "Encounters"],
  [/^\/billing\/[^/]+(\/|$|\?)/, "Invoice"],
  [/^\/billing(\/|$|\?)/, "Billing"],
  [/^\/calendar\/[^/]+(\/|$|\?)/, "Appointment"],
  [/^\/calendar(\/|$|\?)/, "Calendar"],
  [/^\/care\/schedule(\/|$|\?)/, "Care schedule"],
  [/^\/care\/[^/]+(\/|$|\?)/, "Care agreement"],
  [/^\/care(\/|$|\?)/, "Home care"],
  [/^\/reports(\/|$|\?)/, "Reports"],
  [/^\/settings(\/|$|\?)/, "Settings"],
  [/^\/dashboard(\/|$|\?)/, "Dashboard"],
];

/** Name for an in-app path, e.g. "/encounters/abc" → "Encounter". */
export function labelForPath(path: string): string {
  for (const [pattern, label] of LABELS) {
    if (pattern.test(path)) return label;
  }
  return "Back";
}

/**
 * Validate a `?from=` value. Returns null when it is missing or not a
 * same-origin path, so the caller uses its own fallback.
 */
export function parseReturnTo(raw: string | undefined | null): ReturnTo | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > 512) return null;
  // Same-origin absolute paths only: "/x". Not "//host", not "/\host",
  // not "https://host", not "javascript:".
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value.includes("\\")) return null;
  return { href: value, label: labelForPath(value) };
}
