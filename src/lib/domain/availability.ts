import { CLINIC_TZ, clinicDateString } from "./timezone";

/**
 * Suggesting a start time for a new appointment.
 *
 * Booking from a day in the calendar should not then ask what day it is. The
 * form opens on that day at the first time nothing is booked, and the person
 * booking can move it — a suggestion that saves typing, never a constraint.
 *
 * The clinic's opening hours are not configurable yet (the locations screen
 * was withdrawn), so they live here as named constants rather than as numbers
 * buried in a component, ready to be read from settings when that returns.
 */
export const CLINIC_OPENS_MINUTES = 9 * 60; // 09:00
export const CLINIC_CLOSES_MINUTES = 18 * 60; // 18:00
export const SLOT_MINUTES = 30;

/** Statuses that no longer hold a slot, so it counts as free. */
const RELEASED = new Set(["cancelled", "no_show", "rescheduled"]);

export interface BusyPeriod {
  startAt: Date;
  endAt: Date;
  status: string;
}

/** Minutes since midnight of an instant, read in the clinic's timezone. */
export function clinicMinutesOfDay(
  instant: Date,
  timeZone: string = CLINIC_TZ,
): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  // Midnight can format as 24 in some locales' hourCycle; normalise it.
  return (get("hour") % 24) * 60 + get("minute");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "HH:mm" for minutes since midnight. */
export function formatMinutes(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/**
 * The first free half-hour on a day, as "HH:mm".
 *
 * Slots already past are skipped when the day is today — offering 09:00 at
 * four in the afternoon is worse than offering nothing. If the day is
 * genuinely full, opening time is returned: the form must still open
 * somewhere, and the person booking decides what to do about it.
 */
export function firstFreeSlot(params: {
  /** Day being booked, YYYY-MM-DD in clinic time. */
  dayStr: string;
  busy: BusyPeriod[];
  /** For deciding whether the day is today, and how much of it is left. */
  now?: Date;
  timeZone?: string;
}): string {
  const timeZone = params.timeZone ?? CLINIC_TZ;
  const now = params.now ?? new Date();

  const taken = params.busy
    .filter(
      (b) =>
        !RELEASED.has(b.status) &&
        clinicDateString(b.startAt, timeZone) === params.dayStr,
    )
    .map((b) => ({
      from: clinicMinutesOfDay(b.startAt, timeZone),
      to: clinicMinutesOfDay(b.endAt, timeZone),
    }))
    // An appointment running past midnight formats as an earlier time than it
    // started; treat it as busy to the end of the day rather than negative.
    .map((b) => ({ from: b.from, to: b.to > b.from ? b.to : 24 * 60 }));

  const isToday = clinicDateString(now, timeZone) === params.dayStr;
  const earliest = isToday
    ? Math.max(CLINIC_OPENS_MINUTES, ceilToSlot(clinicMinutesOfDay(now, timeZone)))
    : CLINIC_OPENS_MINUTES;

  for (
    let start = earliest;
    start + SLOT_MINUTES <= CLINIC_CLOSES_MINUTES;
    start += SLOT_MINUTES
  ) {
    const end = start + SLOT_MINUTES;
    const overlaps = taken.some((b) => start < b.to && end > b.from);
    if (!overlaps) return formatMinutes(start);
  }

  return formatMinutes(CLINIC_OPENS_MINUTES);
}

function ceilToSlot(minutes: number): number {
  return Math.ceil(minutes / SLOT_MINUTES) * SLOT_MINUTES;
}
