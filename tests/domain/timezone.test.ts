import { describe, expect, it } from "vitest";
import {
  clinicDateString,
  clinicDayWindow,
  clinicGridWindow,
  clinicMonthWindow,
  monthGridDays,
  shiftDay,
  shiftMonth,
  zonedMidnightUtc,
} from "@/lib/domain/timezone";

describe("clinic timezone day windows (A-05 America/Toronto)", () => {
  it("computes Toronto midnight in UTC during EDT (UTC-4)", () => {
    // 2026-07-17 00:00 EDT == 2026-07-17T04:00:00Z
    expect(zonedMidnightUtc("2026-07-17").toISOString()).toBe(
      "2026-07-17T04:00:00.000Z",
    );
  });

  it("computes Toronto midnight in UTC during EST (UTC-5)", () => {
    // 2026-01-15 00:00 EST == 2026-01-15T05:00:00Z
    expect(zonedMidnightUtc("2026-01-15").toISOString()).toBe(
      "2026-01-15T05:00:00.000Z",
    );
  });

  it("builds a [start, end) window covering the local day", () => {
    const { from, to } = clinicDayWindow("2026-07-17");
    expect(from.toISOString()).toBe("2026-07-17T04:00:00.000Z");
    expect(to.toISOString()).toBe("2026-07-18T04:00:00.000Z");

    // A 9pm Toronto appointment (01:00Z next UTC day) is inside the window.
    const evening = new Date("2026-07-18T01:00:00Z"); // 21:00 EDT Jul 17
    expect(evening >= from && evening < to).toBe(true);
  });

  it("maps an instant to its Toronto calendar date", () => {
    // 01:30Z on Jul 18 is still Jul 17 in Toronto (21:30 EDT).
    expect(clinicDateString(new Date("2026-07-18T01:30:00Z"))).toBe("2026-07-17");
  });

  it("shifts day strings across month boundaries", () => {
    expect(shiftDay("2026-07-31", 1)).toBe("2026-08-01");
    expect(shiftDay("2026-08-01", -1)).toBe("2026-07-31");
  });
});

describe("month grid helpers", () => {
  it("shifts months across year boundaries", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("builds a month window in the clinic timezone", () => {
    const { from, to } = clinicMonthWindow("2026-07");
    expect(from.toISOString()).toBe("2026-07-01T04:00:00.000Z"); // EDT
    expect(to.toISOString()).toBe("2026-08-01T04:00:00.000Z");
  });

  it("builds a Sunday-start grid covering the whole month", () => {
    // July 2026: the 1st is a Wednesday (dow 3), the 31st a Friday (dow 5).
    const days = monthGridDays("2026-07");
    expect(days[0]).toBe("2026-06-28"); // Sunday before the 1st
    expect(days[days.length - 1]).toBe("2026-08-01"); // Saturday after the 31st
    expect(days.length % 7).toBe(0);
    expect(days).toContain("2026-07-01");
    expect(days).toContain("2026-07-31");
  });

  it("returns exactly 4 weeks for a Feb starting on Sunday", () => {
    // February 2026 starts Sunday and has 28 days → perfect 4-week grid.
    const days = monthGridDays("2026-02");
    expect(days[0]).toBe("2026-02-01");
    expect(days[days.length - 1]).toBe("2026-02-28");
    expect(days.length).toBe(28);
  });
});

describe("clinicGridWindow", () => {
  it("covers the neighbouring days the grid puts on screen", () => {
    // August 2026 starts on a Saturday, so the grid opens on 26 July and, with
    // 31 August a Monday, runs to 5 September.
    const { from, to } = clinicGridWindow("2026-08");
    const days = monthGridDays("2026-08");
    expect(days[0]).toBe("2026-07-26");
    expect(days[days.length - 1]).toBe("2026-09-05");
    expect(from).toEqual(zonedMidnightUtc("2026-07-26"));
    // Exclusive end: midnight after the last visible day.
    expect(to).toEqual(zonedMidnightUtc("2026-09-06"));
  });

  it("is never narrower than the month itself", () => {
    for (const month of ["2026-01", "2026-02", "2026-08", "2026-11"]) {
      const grid = clinicGridWindow(month);
      const monthOnly = clinicMonthWindow(month);
      expect(grid.from.getTime()).toBeLessThanOrEqual(monthOnly.from.getTime());
      expect(grid.to.getTime()).toBeGreaterThanOrEqual(monthOnly.to.getTime());
    }
  });

  it("spans exactly the days the grid renders, across a DST change", () => {
    // November 2026: the clocks go back inside this grid, so a naive
    // day-count would drift by an hour and clip the last day.
    const { from, to } = clinicGridWindow("2026-11");
    const days = monthGridDays("2026-11");
    expect(from).toEqual(zonedMidnightUtc(days[0]));
    expect(to).toEqual(zonedMidnightUtc(shiftDay(days[days.length - 1], 1)));
  });
});
