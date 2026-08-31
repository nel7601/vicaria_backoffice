import type { AppointmentStatus } from "@/lib/domain/appointment";
import type { LegendItem } from "@/components/ui/status-legend";

/**
 * How each appointment status looks, and the legend that explains it — from
 * one definition.
 *
 * These were written twice, and drifted: the legend promised that rescheduled
 * appointments appear struck through while the grid only struck cancelled and
 * no-shows, so a moved appointment looked like a live one. A legend that
 * disagrees with what it explains is worse than no legend, because it is
 * believed.
 *
 * Grouping by appearance rather than listing statuses one by one is what keeps
 * them in step: the legend is derived from the same groups the grid reads.
 */
interface StatusGroup {
  /** Stable key used by the calendar's status filter in the URL. */
  key: string;
  label: string;
  dotClass: string;
  /** Struck through: this appointment is not going to happen as booked. */
  struck: boolean;
  /** Glyph shown instead of the dot; see the confirmed/awaiting pair below. */
  badge?: string;
  statuses: readonly AppointmentStatus[];
}

const GROUPS: readonly StatusGroup[] = [
  /*
   * Booked and confirmed are the distinction the month view exists to show:
   * one of them is a list of people to call before the day arrives. They used
   * to share a dot, which hid exactly that.
   *
   * The difference is carried by shape, not colour — a hollow ring for a
   * booking still waiting on the patient, a tick once they confirm. Shape
   * survives a glance, a print-out, and a practitioner who does not separate
   * these two hues easily.
   */
  {
    key: "awaiting",
    label: "Awaiting patient confirmation",
    dotClass: "border-2 border-primary",
    struck: false,
    statuses: ["scheduled"],
  },
  {
    key: "confirmed",
    label: "Confirmed by patient",
    // Green: the one state that needs nothing from anybody.
    dotClass: "text-success",
    struck: false,
    badge: "✓",
    statuses: ["confirmed"],
  },
  {
    key: "in_progress",
    label: "Checked in / In progress",
    dotClass: "bg-warning",
    struck: false,
    statuses: ["checked_in", "in_progress"],
  },
  {
    key: "completed",
    label: "Completed",
    dotClass: "bg-success",
    struck: false,
    statuses: ["completed"],
  },
  {
    key: "cancelled",
    label: "Cancelled / No-show",
    dotClass: "bg-danger",
    struck: true,
    statuses: ["cancelled", "no_show"],
  },
  {
    key: "rescheduled",
    label: "Rescheduled",
    dotClass: "bg-muted",
    struck: true,
    statuses: ["rescheduled"],
  },
];

const BY_STATUS = new Map<string, StatusGroup>(
  GROUPS.flatMap((group) => group.statuses.map((s) => [s, group] as const)),
);

/** Dot colour and strike-through for one appointment status. */
export function appointmentStatusStyle(status: string): {
  dotClass: string;
  struck: boolean;
  badge?: string;
} {
  const group = BY_STATUS.get(status);
  return {
    dotClass: group?.dotClass ?? "bg-muted",
    struck: group?.struck ?? false,
    badge: group?.badge,
  };
}

/** The legend above the month grid, in the order the groups are defined. */
export const APPOINTMENT_LEGEND: LegendItem[] = GROUPS.map((g) => ({
  dotClass: g.dotClass,
  label: g.label,
  struck: g.struck,
  badge: g.badge,
}));

/** Every status the groups cover — used by the test that keeps them complete. */
export const COVERED_STATUSES = [...BY_STATUS.keys()];

/**
 * The options offered by the calendar's status filter.
 *
 * Same groups, same wording as the legend: someone filtering for the people
 * they have to call should be picking the row they just read.
 */
export const STATUS_FILTERS = GROUPS.map((g) => ({
  key: g.key,
  label: g.label,
}));

/** The statuses a filter key selects; empty/unknown means "no filter". */
export function statusesForFilter(key: string | undefined): readonly string[] {
  if (!key) return [];
  return GROUPS.find((g) => g.key === key)?.statuses ?? [];
}
