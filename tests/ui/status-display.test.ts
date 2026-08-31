import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_LEGEND,
  COVERED_STATUSES,
  appointmentStatusStyle,
} from "@/app/(app)/calendar/status-display";
import type { AppointmentStatus } from "@/lib/domain/appointment";

const ALL_STATUSES: AppointmentStatus[] = [
  "scheduled",
  "confirmed",
  "checked_in",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
];

describe("appointment status display", () => {
  it("covers every status, so a new one cannot render unexplained", () => {
    // Adding a status to the domain without adding it here would leave it
    // grey and unlisted in the legend — visible, but meaning nothing.
    expect([...COVERED_STATUSES].sort()).toEqual([...ALL_STATUSES].sort());
  });

  it("strikes through everything that will not happen as booked", () => {
    // The bug this replaces: the legend said rescheduled was struck through
    // and the grid did not, so a moved appointment looked live.
    for (const status of ["cancelled", "no_show", "rescheduled"] as const) {
      expect(appointmentStatusStyle(status).struck).toBe(true);
    }
  });

  it("leaves appointments that are still going ahead unstruck", () => {
    for (const status of [
      "scheduled",
      "confirmed",
      "checked_in",
      "in_progress",
      "completed",
    ] as const) {
      expect(appointmentStatusStyle(status).struck).toBe(false);
    }
  });

  it("gives the legend the same appearance it explains", () => {
    // Every legend row must match at least one status rendered that way.
    for (const item of APPOINTMENT_LEGEND) {
      const matching = ALL_STATUSES.map(appointmentStatusStyle).filter(
        (s) => s.dotClass === item.dotClass && s.struck === Boolean(item.struck),
      );
      expect(matching.length).toBeGreaterThan(0);
    }
  });

  it("falls back to a neutral style for an unknown status", () => {
    expect(appointmentStatusStyle("something_new")).toEqual({
      dotClass: "bg-muted",
      struck: false,
    });
  });
});
