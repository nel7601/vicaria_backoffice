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
  label: string;
  dotClass: string;
  /** Struck through: this appointment is not going to happen as booked. */
  struck: boolean;
  statuses: readonly AppointmentStatus[];
}

const GROUPS: readonly StatusGroup[] = [
  {
    label: "Scheduled / Confirmed",
    dotClass: "bg-primary",
    struck: false,
    statuses: ["scheduled", "confirmed"],
  },
  {
    label: "Checked in / In progress",
    dotClass: "bg-warning",
    struck: false,
    statuses: ["checked_in", "in_progress"],
  },
  {
    label: "Completed",
    dotClass: "bg-success",
    struck: false,
    statuses: ["completed"],
  },
  {
    label: "Cancelled / No-show",
    dotClass: "bg-danger",
    struck: true,
    statuses: ["cancelled", "no_show"],
  },
  {
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
} {
  const group = BY_STATUS.get(status);
  return {
    dotClass: group?.dotClass ?? "bg-muted",
    struck: group?.struck ?? false,
  };
}

/** The legend above the month grid, in the order the groups are defined. */
export const APPOINTMENT_LEGEND: LegendItem[] = GROUPS.map((g) => ({
  dotClass: g.dotClass,
  label: g.label,
  struck: g.struck,
}));

/** Every status the groups cover — used by the test that keeps them complete. */
export const COVERED_STATUSES = [...BY_STATUS.keys()];
