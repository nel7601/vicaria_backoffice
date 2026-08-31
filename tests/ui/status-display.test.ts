import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_LEGEND,
  COVERED_STATUSES,
  STATUS_FILTERS,
  appointmentStatusStyle,
  statusesForFilter,
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

  it("tells a confirmed appointment apart from one still awaiting the patient", () => {
    const awaiting = appointmentStatusStyle("scheduled");
    const confirmed = appointmentStatusStyle("confirmed");
    // They must not merely differ in hue: the month view is scanned quickly,
    // and "who still needs calling" is the question it answers.
    expect(confirmed.badge).toBe("✓");
    expect(awaiting.badge).toBeUndefined();
    expect(awaiting.dotClass).not.toBe(confirmed.dotClass);
  });

  it("labels the two states in the legend by what they mean, not by status name", () => {
    const labels = APPOINTMENT_LEGEND.map((i) => i.label);
    expect(labels).toContain("Awaiting patient confirmation");
    expect(labels).toContain("Confirmed by patient");
  });

  it("offers a filter for every group the legend explains", () => {
    expect(STATUS_FILTERS.map((f) => f.label)).toEqual(
      APPOINTMENT_LEGEND.map((i) => i.label),
    );
  });

  it("resolves the awaiting filter to the appointments that need a call", () => {
    expect(statusesForFilter("awaiting")).toEqual(["scheduled"]);
  });

  it("treats a missing or unknown filter as no filter, not as empty results", () => {
    // Returning [] here is what the page reads as "show everything"; an
    // unknown key must not silently hide every appointment.
    expect(statusesForFilter(undefined)).toEqual([]);
    expect(statusesForFilter("nonsense")).toEqual([]);
  });

  it("marks confirmed appointments in green, the one state needing nothing", () => {
    expect(appointmentStatusStyle("confirmed").dotClass).toContain("success");
  });

  it("falls back to a neutral style for an unknown status", () => {
    expect(appointmentStatusStyle("something_new")).toEqual({
      dotClass: "bg-muted",
      struck: false,
    });
  });
});
