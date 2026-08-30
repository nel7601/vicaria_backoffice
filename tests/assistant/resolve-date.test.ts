import { describe, expect, it } from "vitest";
import {
  clinicNow,
  dateSpecSchema,
  DateResolutionError,
  resolveDate,
} from "@/lib/assistant/tools/resolve-date";
import { resolveDateTool } from "@/lib/assistant/tools/resolve-date-tool";
import { zonedInstantUtc } from "@/lib/domain/timezone";

/**
 * Every wrong answer here is a confidently wrong answer to the user: the agent
 * would state an absolute date and query the wrong window. DST and month/year
 * boundaries are the cases the model itself gets wrong, which is exactly why
 * this lives on the server.
 */

// Wednesday 2026-08-26, 14:00 in Toronto.
const WED = zonedInstantUtc("2026-08-26", 14);

describe("relative days", () => {
  it("resolves today, tomorrow and yesterday", () => {
    expect(resolveDate({ kind: "day", offsetDays: 0 }, WED).startDay).toBe("2026-08-26");
    expect(resolveDate({ kind: "day", offsetDays: 1 }, WED).startDay).toBe("2026-08-27");
    expect(resolveDate({ kind: "day", offsetDays: -1 }, WED).startDay).toBe("2026-08-25");
  });

  it("uses the clinic day, not the server's UTC day", () => {
    // 21:00 in Toronto on the 26th is already the 27th in UTC.
    const evening = zonedInstantUtc("2026-08-26", 21);
    expect(evening.getUTCDate()).toBe(27);
    expect(resolveDate({ kind: "day", offsetDays: 0 }, evening).startDay).toBe("2026-08-26");
  });

  it("crosses a month end", () => {
    const aug31 = zonedInstantUtc("2026-08-31", 10);
    expect(resolveDate({ kind: "day", offsetDays: 1 }, aug31).startDay).toBe("2026-09-01");
  });

  it("crosses a year end", () => {
    const dec31 = zonedInstantUtc("2026-12-31", 10);
    expect(resolveDate({ kind: "day", offsetDays: 1 }, dec31).startDay).toBe("2027-01-01");
  });
});

describe("weekdays", () => {
  it("finds the coming Friday from a Wednesday", () => {
    const r = resolveDate({ kind: "weekday", weekday: "friday", direction: "next" }, WED);
    expect(r.startDay).toBe("2026-08-28");
  });

  it("never resolves 'next <weekday>' to today", () => {
    // Asked on a Wednesday, "next Wednesday" is seven days out, not today.
    const r = resolveDate({ kind: "weekday", weekday: "wednesday", direction: "next" }, WED);
    expect(r.startDay).toBe("2026-09-02");
  });

  it("never resolves 'last <weekday>' to today either", () => {
    const r = resolveDate({ kind: "weekday", weekday: "wednesday", direction: "last" }, WED);
    expect(r.startDay).toBe("2026-08-19");
  });

  it("looks backwards for 'last'", () => {
    const r = resolveDate({ kind: "weekday", weekday: "friday", direction: "last" }, WED);
    expect(r.startDay).toBe("2026-08-21");
  });
});

describe("weeks and months", () => {
  it("returns Sunday-to-Saturday for the current week", () => {
    const r = resolveDate({ kind: "week", offsetWeeks: 0 }, WED);
    expect([r.startDay, r.endDay]).toEqual(["2026-08-23", "2026-08-29"]);
  });

  it("moves a whole week forward", () => {
    const r = resolveDate({ kind: "week", offsetWeeks: 1 }, WED);
    expect([r.startDay, r.endDay]).toEqual(["2026-08-30", "2026-09-05"]);
  });

  it("covers a calendar month exactly", () => {
    const r = resolveDate({ kind: "month", offsetMonths: 0 }, WED);
    expect([r.startDay, r.endDay]).toEqual(["2026-08-01", "2026-08-31"]);
  });

  it("gets February right in a non-leap year", () => {
    const jan = zonedInstantUtc("2026-01-15", 10);
    const r = resolveDate({ kind: "month", offsetMonths: 1 }, jan);
    expect(r.endDay).toBe("2026-02-28");
  });

  it("gets February right in a leap year", () => {
    const jan = zonedInstantUtc("2028-01-15", 10);
    const r = resolveDate({ kind: "month", offsetMonths: 1 }, jan);
    expect(r.endDay).toBe("2028-02-29");
  });

  it("steps back across a year boundary", () => {
    const jan = zonedInstantUtc("2026-01-15", 10);
    const r = resolveDate({ kind: "month", offsetMonths: -1 }, jan);
    expect([r.startDay, r.endDay]).toEqual(["2025-12-01", "2025-12-31"]);
  });
});

describe("years", () => {
  it("covers a calendar year", () => {
    const r = resolveDate({ kind: "year", offsetYears: 0 }, WED);
    expect([r.startDay, r.endDay]).toEqual(["2026-01-01", "2026-12-31"]);
  });

  it("steps back a year", () => {
    const r = resolveDate({ kind: "year", offsetYears: -1 }, WED);
    expect([r.startDay, r.endDay]).toEqual(["2025-01-01", "2025-12-31"]);
  });

  it("includes 29 February in a leap year", () => {
    const r = resolveDate({ kind: "year", offsetYears: 2 }, WED);
    expect(r.startDay).toBe("2028-01-01");
    // 366 days, and DST cancels out across a full year.
    expect(Math.round((r.to.getTime() - r.from.getTime()) / 86_400_000)).toBe(366);
  });

  it("covers 365 days in an ordinary year", () => {
    const r = resolveDate({ kind: "year", offsetYears: 0 }, WED);
    expect(Math.round((r.to.getTime() - r.from.getTime()) / 86_400_000)).toBe(365);
  });
});

describe("DST", () => {
  it("covers 23 hours on the spring-forward day", () => {
    // Toronto springs forward on 2026-03-08.
    const r = resolveDate({ kind: "date", date: "2026-03-08" }, WED);
    expect((r.to.getTime() - r.from.getTime()) / 3_600_000).toBe(23);
  });

  it("covers 25 hours on the fall-back day", () => {
    // Toronto falls back on 2026-11-01.
    const r = resolveDate({ kind: "date", date: "2026-11-01" }, WED);
    expect((r.to.getTime() - r.from.getTime()) / 3_600_000).toBe(25);
  });

  it("keeps a week containing a DST change at 7 clinic days", () => {
    const r = resolveDate({ kind: "date", date: "2026-03-08" }, WED);
    const week = resolveDate({ kind: "week", offsetWeeks: 0 }, r.from);
    expect([week.startDay, week.endDay]).toEqual(["2026-03-08", "2026-03-14"]);
    // 7 days minus the hour lost to the spring-forward.
    expect((week.to.getTime() - week.from.getTime()) / 3_600_000).toBe(167);
  });
});

describe("explicit ranges", () => {
  it("is inclusive of both ends", () => {
    const r = resolveDate({ kind: "range", from: "2026-08-01", to: "2026-08-03" }, WED);
    expect(r.to.getTime() - r.from.getTime()).toBe(3 * 24 * 3_600_000);
  });

  it("refuses a backwards range instead of returning an empty window", () => {
    expect(() =>
      resolveDate({ kind: "range", from: "2026-08-05", to: "2026-08-01" }, WED),
    ).toThrow(DateResolutionError);
  });
});

describe("input validation", () => {
  it("rejects a malformed date", () => {
    expect(dateSpecSchema.safeParse({ kind: "date", date: "26-08-2026" }).success).toBe(false);
  });

  it("rejects an unknown weekday", () => {
    expect(
      dateSpecSchema.safeParse({ kind: "weekday", weekday: "viernes", direction: "next" }).success,
    ).toBe(false);
  });

  it("rejects an absurd offset rather than computing it", () => {
    expect(dateSpecSchema.safeParse({ kind: "day", offsetDays: 100000 }).success).toBe(false);
  });
});

describe("clinicNow", () => {
  it("describes the current clinic day for the turn's system context", () => {
    expect(clinicNow(WED)).toEqual({
      today: "2026-08-26",
      weekday: "wednesday",
      weekStart: "2026-08-23",
      month: "2026-08",
      timeZone: "America/Toronto",
    });
  });
});

/**
 * The weekday has to come from the tool, not from the model.
 *
 * A voice agent told a caller that 16 November 2026 was a Thursday — it is a
 * Monday — because nothing in the answer could tell it otherwise and it did
 * the arithmetic itself. Forbidding that in a prompt does not work when the
 * alternative is having no answer at all.
 */
describe("the weekday of a resolved range", () => {
  const ctx = {
    principal: { locale: "es" } as never,
    now: zonedInstantUtc("2026-08-30", 12),
    timeZone: "America/Toronto",
  } as never;

  it("names the weekday of a single day", async () => {
    const out = (await resolveDateTool.execute(
      { range: { kind: "date", date: "2026-11-16" } } as never,
      ctx,
    )) as { startDay: string; startWeekday: string; endWeekday?: string };
    expect(out.startDay).toBe("2026-11-16");
    expect(out.startWeekday).toBe("monday");
    // One day is one weekday; repeating it would invite reading both aloud.
    expect(out.endWeekday).toBeUndefined();
  });

  it("names both ends of a range that spans days", async () => {
    const out = (await resolveDateTool.execute(
      { range: { kind: "week", offsetWeeks: 0 } } as never,
      ctx,
    )) as { startWeekday: string; endWeekday?: string };
    expect(out.startWeekday).toBe("sunday");
    expect(out.endWeekday).toBe("saturday");
  });

  it("is not knocked off by a timezone offset", async () => {
    // Read at midnight the answer would be the previous day west of UTC.
    const out = (await resolveDateTool.execute(
      { range: { kind: "date", date: "2026-01-01" } } as never,
      ctx,
    )) as { startWeekday: string };
    expect(out.startWeekday).toBe("thursday");
  });
});
