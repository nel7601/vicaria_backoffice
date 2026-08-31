import { describe, expect, it } from "vitest";
import {
  clinicMinutesOfDay,
  firstFreeSlot,
  formatMinutes,
} from "@/lib/domain/availability";

// 14:00 UTC is 10:00 in Toronto during daylight saving.
const at = (iso: string) => new Date(iso);
const booking = (startIso: string, endIso: string, status = "confirmed") => ({
  startAt: at(startIso),
  endAt: at(endIso),
  status,
});

describe("clinicMinutesOfDay", () => {
  it("reads the clock in clinic time, not UTC", () => {
    expect(clinicMinutesOfDay(at("2026-09-02T13:00:00Z"))).toBe(9 * 60);
  });

  it("treats midnight as zero, not twenty-four hundred", () => {
    expect(clinicMinutesOfDay(at("2026-09-02T04:00:00Z"))).toBe(0);
  });
});

describe("firstFreeSlot", () => {
  const day = "2026-09-02";
  const notToday = at("2026-08-20T12:00:00Z");

  it("offers opening time when the day is empty", () => {
    expect(firstFreeSlot({ dayStr: day, busy: [], now: notToday })).toBe("09:00");
  });

  it("skips a slot that is already booked", () => {
    const busy = [booking("2026-09-02T13:00:00Z", "2026-09-02T13:30:00Z")];
    expect(firstFreeSlot({ dayStr: day, busy, now: notToday })).toBe("09:30");
  });

  it("steps over consecutive bookings to the first real gap", () => {
    const busy = [
      booking("2026-09-02T13:00:00Z", "2026-09-02T14:00:00Z"), // 09:00–10:00
      booking("2026-09-02T14:00:00Z", "2026-09-02T14:30:00Z"), // 10:00–10:30
    ];
    expect(firstFreeSlot({ dayStr: day, busy, now: notToday })).toBe("10:30");
  });

  it("counts a cancelled appointment as free — the slot was given back", () => {
    const busy = [
      booking("2026-09-02T13:00:00Z", "2026-09-02T13:30:00Z", "cancelled"),
    ];
    expect(firstFreeSlot({ dayStr: day, busy, now: notToday })).toBe("09:00");
  });

  it("ignores appointments from other days", () => {
    const busy = [booking("2026-09-03T13:00:00Z", "2026-09-03T13:30:00Z")];
    expect(firstFreeSlot({ dayStr: day, busy, now: notToday })).toBe("09:00");
  });

  it("does not offer a time that has already passed today", () => {
    // 18:00 UTC is 14:00 in Toronto: the morning is gone.
    const now = at("2026-09-02T18:00:00Z");
    expect(firstFreeSlot({ dayStr: day, busy: [], now })).toBe("14:00");
  });

  it("rounds a mid-slot 'now' up rather than suggesting the past", () => {
    // 14:10 local — the next usable slot is 14:30, not 14:10.
    const now = at("2026-09-02T18:10:00Z");
    expect(firstFreeSlot({ dayStr: day, busy: [], now })).toBe("14:30");
  });

  it("falls back to opening time when the day is completely full", () => {
    const busy = [booking("2026-09-02T13:00:00Z", "2026-09-02T22:00:00Z")];
    expect(firstFreeSlot({ dayStr: day, busy, now: notToday })).toBe("09:00");
  });
});

describe("formatMinutes", () => {
  it("pads to a time a date input accepts", () => {
    expect(formatMinutes(9 * 60)).toBe("09:00");
    expect(formatMinutes(13 * 60 + 5)).toBe("13:05");
  });
});
