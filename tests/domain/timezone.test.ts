import { describe, expect, it } from "vitest";
import {
  clinicDateString,
  clinicDayWindow,
  shiftDay,
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
