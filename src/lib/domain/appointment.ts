/**
 * Appointment domain logic (spec §6.3, Appendix A).
 * Status state machine, conflict detection and reschedule linkage — pure and
 * unit-tested.
 */

export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "checked_in"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show"
  | "rescheduled";

/** Statuses that no longer occupy the practitioner's time (ignored in conflicts). */
export const INACTIVE_STATUSES: readonly AppointmentStatus[] = [
  "cancelled",
  "no_show",
  "rescheduled",
];

/**
 * Allowed transitions (FR-APT-004). Terminal states have no outgoing edges.
 * Any active appointment may be cancelled, marked no-show, or rescheduled.
 */
const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ["confirmed", "checked_in", "cancelled", "no_show", "rescheduled"],
  confirmed: ["checked_in", "cancelled", "no_show", "rescheduled"],
  checked_in: ["in_progress", "cancelled", "no_show"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  no_show: [],
  rescheduled: [],
};

export function canTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses whose change should require a reason (§FR-APT-004). */
export function transitionRequiresReason(to: AppointmentStatus): boolean {
  return to === "cancelled" || to === "no_show" || to === "rescheduled";
}

export interface TimeSlot {
  startAt: Date | string;
  endAt: Date | string;
  status?: AppointmentStatus;
  id?: string;
}

function ms(v: Date | string): number {
  return typeof v === "string" ? new Date(v).getTime() : v.getTime();
}

/** True when two half-open intervals [start,end) overlap. */
export function overlaps(a: TimeSlot, b: TimeSlot): boolean {
  return ms(a.startAt) < ms(b.endAt) && ms(b.startAt) < ms(a.endAt);
}

/**
 * Detect practitioner conflicts for a proposed slot (FR-APT-003). Existing
 * appointments in an inactive status are ignored, as is the appointment being
 * edited (matched by id).
 */
export function findConflicts(
  proposed: TimeSlot,
  existing: TimeSlot[],
  opts: { ignoreId?: string } = {},
): TimeSlot[] {
  return existing.filter((e) => {
    if (opts.ignoreId && e.id === opts.ignoreId) return false;
    if (e.status && INACTIVE_STATUSES.includes(e.status)) return false;
    return overlaps(proposed, e);
  });
}

/** Validate a proposed appointment time (FR-APT-002). */
export function isValidTimeRange(
  startAt: Date | string,
  endAt: Date | string,
): boolean {
  return ms(endAt) > ms(startAt);
}
