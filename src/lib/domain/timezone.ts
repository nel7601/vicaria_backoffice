/**
 * Clinic timezone helpers (spec A-05, NFR-07: America/Toronto).
 *
 * The server may run in UTC (Vercel), so "today" and day windows must be
 * computed in the clinic timezone or evening appointments drift into the
 * wrong day. DST-safe: offsets are derived via Intl, never hardcoded.
 */

export const CLINIC_TZ = "America/Toronto";

/** YYYY-MM-DD of an instant as seen in the clinic timezone. */
export function clinicDateString(instant: Date, timeZone: string = CLINIC_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Wall-clock fields of an instant in a timezone. */
function wallClock(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return {
    y: get("year"),
    mo: get("month"),
    d: get("day"),
    // Intl may render midnight as 24 in some engines; normalize.
    h: get("hour") % 24,
    mi: get("minute"),
    s: get("second"),
  };
}

/**
 * UTC instant corresponding to local midnight of `dayStr` (YYYY-MM-DD) in the
 * given timezone. Two-pass fixed-point handles DST transitions.
 */
export function zonedMidnightUtc(
  dayStr: string,
  timeZone: string = CLINIC_TZ,
): Date {
  const [y, mo, d] = dayStr.split("-").map(Number);
  // Initial guess: treat local midnight as if it were UTC.
  let guess = Date.UTC(y, mo - 1, d, 0, 0, 0);
  for (let i = 0; i < 3; i++) {
    const w = wallClock(new Date(guess), timeZone);
    const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
    const desired = Date.UTC(y, mo - 1, d, 0, 0, 0);
    const diff = desired - asUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

/** [start, end) UTC window covering one clinic-timezone day. */
export function clinicDayWindow(
  dayStr: string,
  timeZone: string = CLINIC_TZ,
): { from: Date; to: Date } {
  const from = zonedMidnightUtc(dayStr, timeZone);
  // Next day's local midnight (handles 23/25-hour DST days correctly).
  const [y, mo, d] = dayStr.split("-").map(Number);
  const nextDay = new Date(Date.UTC(y, mo - 1, d + 1, 12)); // noon avoids skew
  const nextStr = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDay.getUTCDate()).padStart(2, "0")}`;
  const to = zonedMidnightUtc(nextStr, timeZone);
  return { from, to };
}

/** Shift a YYYY-MM-DD string by n days (pure calendar arithmetic). */
export function shiftDay(dayStr: string, days: number): string {
  const [y, mo, d] = dayStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + days, 12));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
