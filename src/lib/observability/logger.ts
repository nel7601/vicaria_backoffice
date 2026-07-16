/**
 * Structured, PHI-safe logging (spec SEC-06, NFR-08).
 * Never log PHI: known sensitive keys are dropped and free-text emails/phones
 * are masked. Include a request id for correlation, never patient identifiers.
 */

const SENSITIVE_KEYS = new Set([
  "email",
  "phone",
  "phonee164",
  "phone_e164",
  "dateofbirth",
  "date_of_birth",
  "dob",
  "legalfirstname",
  "legallastname",
  "legal_first_name",
  "legal_last_name",
  "preferredname",
  "address",
  "summary",
  "contentsnapshot",
  "content_snapshot",
  "note",
  "notes",
  "password",
  "token",
  "authorization",
  "secret",
  "signature",
]);

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (typeof value === "string") {
    return value.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[phone]");
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase())
        ? "[redacted]"
        : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

type Level = "debug" | "info" | "warn" | "error";

export function log(
  level: Level,
  message: string,
  context: Record<string, unknown> = {},
): void {
  const entry = {
    level,
    message,
    ...(redact(context) as Record<string, unknown>),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (m: string, c?: Record<string, unknown>) => log("debug", m, c),
  info: (m: string, c?: Record<string, unknown>) => log("info", m, c),
  warn: (m: string, c?: Record<string, unknown>) => log("warn", m, c),
  error: (m: string, c?: Record<string, unknown>) => log("error", m, c),
};
