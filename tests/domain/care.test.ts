import { describe, expect, it } from "vitest";
import {
  canTransitionAgreement,
  canTransitionShift,
  findShiftConflicts,
  formatMinutes,
  isValidShiftRange,
  scheduledMinutesInWindow,
  shiftMinutes,
  shiftTransitionRequiresReason,
  workedMinutes,
} from "@/lib/domain/care";

describe("care agreement lifecycle", () => {
  it("follows draft → active ⇄ paused → ended", () => {
    expect(canTransitionAgreement("draft", "active")).toBe(true);
    expect(canTransitionAgreement("active", "paused")).toBe(true);
    expect(canTransitionAgreement("paused", "active")).toBe(true);
    expect(canTransitionAgreement("active", "ended")).toBe(true);
    expect(canTransitionAgreement("ended", "active")).toBe(false);
    expect(canTransitionAgreement("draft", "paused")).toBe(false);
  });
});

describe("care shift lifecycle", () => {
  it("allows the visit flow scheduled → confirmed → in_progress → completed", () => {
    expect(canTransitionShift("scheduled", "confirmed")).toBe(true);
    expect(canTransitionShift("confirmed", "in_progress")).toBe(true);
    expect(canTransitionShift("in_progress", "completed")).toBe(true);
  });

  it("supports check-in without prior confirmation", () => {
    expect(canTransitionShift("scheduled", "in_progress")).toBe(true);
  });

  it("locks terminal states", () => {
    expect(canTransitionShift("completed", "scheduled")).toBe(false);
    expect(canTransitionShift("cancelled", "confirmed")).toBe(false);
    expect(canTransitionShift("no_show", "in_progress")).toBe(false);
  });

  it("requires a reason for cancellation and no-show", () => {
    expect(shiftTransitionRequiresReason("cancelled")).toBe(true);
    expect(shiftTransitionRequiresReason("no_show")).toBe(true);
    expect(shiftTransitionRequiresReason("completed")).toBe(false);
  });
});

describe("shift conflicts", () => {
  const base = {
    startAt: new Date("2026-09-01T14:00:00Z"),
    endAt: new Date("2026-09-01T18:00:00Z"),
  };

  it("detects overlapping active shifts", () => {
    const conflicts = findShiftConflicts(base, [
      {
        startAt: new Date("2026-09-01T16:00:00Z"),
        endAt: new Date("2026-09-01T20:00:00Z"),
        status: "scheduled",
      },
    ]);
    expect(conflicts).toHaveLength(1);
  });

  it("ignores cancelled shifts and back-to-back boundaries", () => {
    const conflicts = findShiftConflicts(base, [
      {
        startAt: new Date("2026-09-01T16:00:00Z"),
        endAt: new Date("2026-09-01T20:00:00Z"),
        status: "cancelled",
      },
      {
        startAt: new Date("2026-09-01T18:00:00Z"),
        endAt: new Date("2026-09-01T20:00:00Z"),
        status: "scheduled",
      },
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it("rejects zero/negative ranges", () => {
    expect(isValidShiftRange(base.startAt, base.startAt)).toBe(false);
    expect(isValidShiftRange(base.startAt, base.endAt)).toBe(true);
  });
});

describe("weekly hours tracking", () => {
  const weekStart = new Date("2026-08-30T04:00:00Z"); // Sun midnight Toronto (EDT)
  const weekEnd = new Date("2026-09-06T04:00:00Z");

  it("sums active shift minutes and clips at window edges", () => {
    const shifts = [
      {
        startAt: new Date("2026-08-31T13:00:00Z"),
        endAt: new Date("2026-08-31T17:00:00Z"),
        status: "completed",
      }, // 4h
      {
        startAt: new Date("2026-09-02T13:00:00Z"),
        endAt: new Date("2026-09-02T16:30:00Z"),
        status: "scheduled",
      }, // 3h30
      {
        startAt: new Date("2026-09-02T18:00:00Z"),
        endAt: new Date("2026-09-02T20:00:00Z"),
        status: "cancelled",
      }, // ignored
      {
        startAt: new Date("2026-09-06T02:00:00Z"),
        endAt: new Date("2026-09-06T06:00:00Z"),
        status: "scheduled",
      }, // clipped to 2h
    ];
    expect(scheduledMinutesInWindow(shifts, weekStart, weekEnd)).toBe(
      4 * 60 + 210 + 120,
    );
  });

  it("computes shift and worked minutes", () => {
    expect(
      shiftMinutes({
        startAt: new Date("2026-09-01T14:00:00Z"),
        endAt: new Date("2026-09-01T18:00:00Z"),
      }),
    ).toBe(240);
    expect(
      workedMinutes({
        startAt: new Date("2026-09-01T14:00:00Z"),
        endAt: new Date("2026-09-01T18:00:00Z"),
        checkInAt: new Date("2026-09-01T14:10:00Z"),
        checkOutAt: new Date("2026-09-01T18:05:00Z"),
      }),
    ).toBe(235);
  });

  it("formats minutes as hours", () => {
    expect(formatMinutes(1200)).toBe("20h");
    expect(formatMinutes(1230)).toBe("20h 30m");
  });
});
