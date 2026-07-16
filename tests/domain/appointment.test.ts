import { describe, expect, it } from "vitest";
import {
  canTransition,
  findConflicts,
  isValidTimeRange,
  overlaps,
  transitionRequiresReason,
} from "@/lib/domain/appointment";

describe("appointment status machine (§FR-APT-004)", () => {
  it("allows the happy path", () => {
    expect(canTransition("scheduled", "confirmed")).toBe(true);
    expect(canTransition("confirmed", "checked_in")).toBe(true);
    expect(canTransition("checked_in", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "completed")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    expect(canTransition("completed", "scheduled")).toBe(false);
    expect(canTransition("cancelled", "confirmed")).toBe(false);
    expect(canTransition("scheduled", "completed")).toBe(false);
  });

  it("flags transitions that require a reason", () => {
    expect(transitionRequiresReason("cancelled")).toBe(true);
    expect(transitionRequiresReason("no_show")).toBe(true);
    expect(transitionRequiresReason("rescheduled")).toBe(true);
    expect(transitionRequiresReason("confirmed")).toBe(false);
  });
});

describe("conflict detection (§FR-APT-003)", () => {
  const slot = (s: string, e: string, extra = {}) => ({
    startAt: `2026-07-20T${s}:00Z`,
    endAt: `2026-07-20T${e}:00Z`,
    ...extra,
  });

  it("detects overlaps", () => {
    expect(overlaps(slot("10:00", "11:00"), slot("10:30", "11:30"))).toBe(true);
    expect(overlaps(slot("10:00", "11:00"), slot("11:00", "12:00"))).toBe(false);
  });

  it("finds practitioner conflicts, ignoring inactive appointments", () => {
    const existing = [
      slot("10:00", "11:00", { id: "x", status: "confirmed" as const }),
      slot("10:30", "11:30", { id: "y", status: "cancelled" as const }),
    ];
    const conflicts = findConflicts(slot("10:15", "10:45"), existing);
    expect(conflicts.map((c) => c.id)).toEqual(["x"]);
  });

  it("ignores the appointment being edited", () => {
    const existing = [slot("10:00", "11:00", { id: "self", status: "confirmed" as const })];
    expect(
      findConflicts(slot("10:00", "11:00"), existing, { ignoreId: "self" }),
    ).toHaveLength(0);
  });

  it("validates the time range", () => {
    expect(isValidTimeRange("2026-07-20T10:00:00Z", "2026-07-20T11:00:00Z")).toBe(
      true,
    );
    expect(isValidTimeRange("2026-07-20T11:00:00Z", "2026-07-20T10:00:00Z")).toBe(
      false,
    );
  });
});
