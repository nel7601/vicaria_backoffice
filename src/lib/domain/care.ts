/**
 * Home-care domain rules (Vicaria Care service).
 *
 * Mirrors standard home-care operations: an agreement fixes contracted weekly
 * hours over a period; shifts are scheduled against it, assigned to a
 * caregiver, and progress through a visit lifecycle with EVV-style
 * check-in/check-out.
 */

export const CARE_AGREEMENT_STATUSES = [
  "draft",
  "active",
  "paused",
  "ended",
] as const;
export type CareAgreementStatus = (typeof CARE_AGREEMENT_STATUSES)[number];

export const CARE_SHIFT_STATUSES = [
  "scheduled",
  "confirmed",
  "in_progress",
  "completed",
  "needs_review",
  "cancelled",
  "no_show",
  "missed",
] as const;
export type CareShiftStatus = (typeof CARE_SHIFT_STATUSES)[number];

/** Agreement lifecycle: draft → active ⇄ paused → ended (ended is final). */
const AGREEMENT_TRANSITIONS: Record<CareAgreementStatus, CareAgreementStatus[]> = {
  draft: ["active", "ended"],
  active: ["paused", "ended"],
  paused: ["active", "ended"],
  ended: [],
};

export function canTransitionAgreement(
  from: CareAgreementStatus,
  to: CareAgreementStatus,
): boolean {
  return AGREEMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Shift lifecycle (spec §10.3):
 * scheduled → confirmed | in_progress (check-in) | cancelled | no_show | missed
 * confirmed → in_progress | cancelled | no_show | missed
 * in_progress → completed | needs_review (check-out with a relevant
 *   difference between scheduled and actual time, or pending items)
 * needs_review → completed (admin approves hours)
 */
const SHIFT_TRANSITIONS: Record<CareShiftStatus, CareShiftStatus[]> = {
  scheduled: ["confirmed", "in_progress", "cancelled", "no_show", "missed"],
  confirmed: ["in_progress", "cancelled", "no_show", "missed"],
  in_progress: ["completed", "needs_review"],
  needs_review: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
  missed: [],
};

export function canTransitionShift(
  from: CareShiftStatus,
  to: CareShiftStatus,
): boolean {
  return SHIFT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function shiftTransitionRequiresReason(to: CareShiftStatus): boolean {
  return to === "cancelled" || to === "no_show" || to === "missed";
}

/** Statuses that block a caregiver's time (mirror of the DB exclusion). */
export const ACTIVE_SHIFT_STATUSES: CareShiftStatus[] = [
  "scheduled",
  "confirmed",
  "in_progress",
  "completed",
  "needs_review",
];

/**
 * Minutes of tolerance between scheduled and actual duration before a
 * checked-out visit needs administrative review (spec §10.4).
 */
export const REVIEW_THRESHOLD_MINUTES = 15;

/**
 * Outcome of a check-out: completed when actual time matches the schedule
 * within tolerance, needs_review otherwise (admin approves the hours).
 */
export function checkOutOutcome(
  scheduledMinutes: number,
  actualMinutes: number,
  toleranceMinutes: number = REVIEW_THRESHOLD_MINUTES,
): "completed" | "needs_review" {
  return Math.abs(actualMinutes - scheduledMinutes) > toleranceMinutes
    ? "needs_review"
    : "completed";
}

/** Statuses whose hours count as billable once approved (spec §10.4). */
export const BILLABLE_SHIFT_STATUSES: CareShiftStatus[] = ["completed"];

export interface TimeRange {
  startAt: Date;
  endAt: Date;
}

export function isValidShiftRange(startAt: Date, endAt: Date): boolean {
  return endAt.getTime() > startAt.getTime();
}

/** Overlapping [start, end) intervals among a caregiver's active shifts. */
export function findShiftConflicts<T extends TimeRange & { status: string }>(
  candidate: TimeRange,
  existing: T[],
): T[] {
  return existing.filter(
    (s) =>
      (ACTIVE_SHIFT_STATUSES as string[]).includes(s.status) &&
      s.startAt < candidate.endAt &&
      s.endAt > candidate.startAt,
  );
}

export function shiftMinutes(range: TimeRange): number {
  return Math.round((range.endAt.getTime() - range.startAt.getTime()) / 60000);
}

/**
 * Minutes scheduled inside a window, counting only time-blocking shifts and
 * clipping shifts that cross the window boundary.
 */
export function scheduledMinutesInWindow<
  T extends TimeRange & { status: string },
>(shifts: T[], windowStart: Date, windowEnd: Date): number {
  let total = 0;
  for (const s of shifts) {
    if (!(ACTIVE_SHIFT_STATUSES as string[]).includes(s.status)) continue;
    const from = Math.max(s.startAt.getTime(), windowStart.getTime());
    const to = Math.min(s.endAt.getTime(), windowEnd.getTime());
    if (to > from) total += Math.round((to - from) / 60000);
  }
  return total;
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Actual worked minutes from EVV check-in/out, falling back to schedule. */
export function workedMinutes(shift: {
  startAt: Date;
  endAt: Date;
  checkInAt: Date | null;
  checkOutAt: Date | null;
}): number {
  const start = shift.checkInAt ?? shift.startAt;
  const end = shift.checkOutAt ?? shift.endAt;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}
