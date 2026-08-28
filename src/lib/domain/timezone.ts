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

/**
 * UTC instant for a wall-clock time on a given day in the clinic timezone.
 *
 * "Tuesday at 3pm" is a local wall-clock time; storing it needs the offset in
 * force on that date, which changes twice a year. Same fixed-point approach as
 * `zonedMidnightUtc`, so a DST boundary cannot shift the appointment an hour.
 */
export function zonedInstantUtc(
  dayStr: string,
  hour: number,
  minute = 0,
  timeZone: string = CLINIC_TZ,
): Date {
  const [y, mo, d] = dayStr.split("-").map(Number);
  let guess = Date.UTC(y, mo - 1, d, hour, minute, 0);
  for (let i = 0; i < 3; i++) {
    const w = wallClock(new Date(guess), timeZone);
    const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
    const desired = Date.UTC(y, mo - 1, d, hour, minute, 0);
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

/** YYYY-MM of an instant in the clinic timezone. */
export function clinicMonthString(
  instant: Date,
  timeZone: string = CLINIC_TZ,
): string {
  return clinicDateString(instant, timeZone).slice(0, 7);
}

/** Shift a YYYY-MM string by n months. */
export function shiftMonth(monthStr: string, months: number): string {
  const [y, m] = monthStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, 15));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** [start, end) UTC window covering one clinic-timezone calendar month. */
export function clinicMonthWindow(
  monthStr: string,
  timeZone: string = CLINIC_TZ,
): { from: Date; to: Date } {
  const from = zonedMidnightUtc(`${monthStr}-01`, timeZone);
  const to = zonedMidnightUtc(`${shiftMonth(monthStr, 1)}-01`, timeZone);
  return { from, to };
}

/** Sunday (YYYY-MM-DD) of the week containing dayStr (pure calendar math). */
export function weekStartDay(dayStr: string): string {
  const [y, m, d] = dayStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return shiftDay(dayStr, -dow);
}

/** [start, end) UTC window covering the clinic-timezone week of dayStr. */
export function clinicWeekWindow(
  dayStr: string,
  timeZone: string = CLINIC_TZ,
): { from: Date; to: Date; weekStart: string } {
  const weekStart = weekStartDay(dayStr);
  return {
    from: zonedMidnightUtc(weekStart, timeZone),
    to: zonedMidnightUtc(shiftDay(weekStart, 7), timeZone),
    weekStart,
  };
}

/**
 * Day strings for a Sunday-start month grid: from the Sunday on/before the 1st
 * to the Saturday on/after the last day (pure calendar math, 35 or 42 cells).
 */
export function monthGridDays(monthStr: string): string[] {
  const [y, m] = monthStr.split("-").map(Number);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(y, m - 1, daysInMonth)).getUTCDay();

  const start = shiftDay(`${monthStr}-01`, -firstDow);
  const total = firstDow + daysInMonth + (6 - lastDow);
  return Array.from({ length: total }, (_, i) => shiftDay(start, i));
}
