import { describe, expect, it } from "vitest";
import {
  spokenDay,
  spokenDayOrNull,
  spokenInstant,
  spokenInstantOrNull,
} from "@/lib/assistant/tools/when";

const TZ = "America/Toronto";

describe("spokenInstant", () => {
  /**
   * The three appointments Viki got wrong on air, 2026-09-05. She was handed
   * UTC and asked to do the rest; she named every weekday one day early and
   * read 13:00Z as "one in the afternoon". These are the same instants with
   * the answers the server now supplies.
   */
  it.each([
    ["2026-09-07T18:00:00.000Z", "2026-09-07", "lunes", "14:00"],
    ["2026-09-08T14:00:00.000Z", "2026-09-08", "martes", "10:00"],
    ["2026-09-10T13:00:00.000Z", "2026-09-10", "jueves", "09:00"],
  ])("says %s as its real clinic day and time", (iso, date, weekday, time) => {
    const said = spokenInstant(new Date(iso), TZ);
    expect(said.date).toBe(date);
    expect(said.weekday).toBe(weekday);
    expect(said.time).toBe(time);
    expect(said.when).toContain(weekday);
  });

  it("keeps the instant for anything that has to round-trip", () => {
    const iso = "2026-09-10T13:00:00.000Z";
    expect(spokenInstant(new Date(iso), TZ).iso).toBe(iso);
  });

  it("moves a late-evening appointment onto the day the clinic calls it", () => {
    // 00:30 UTC is the previous evening in Toronto. Reading the UTC date here
    // puts the appointment on the wrong day — the exact off-by-one that
    // started this.
    const said = spokenInstant(new Date("2026-09-11T00:30:00.000Z"), TZ);
    expect(said.date).toBe("2026-09-10");
    expect(said.weekday).toBe("jueves");
    expect(said.time).toBe("20:30");
  });

  it("follows daylight saving instead of a fixed offset", () => {
    // Same wall-clock hour either side of the November change: −4 then −5.
    expect(spokenInstant(new Date("2026-10-15T14:00:00.000Z"), TZ).time).toBe("10:00");
    expect(spokenInstant(new Date("2026-12-15T14:00:00.000Z"), TZ).time).toBe("09:00");
  });

  it("answers in English when that is the user's language", () => {
    const said = spokenInstant(new Date("2026-09-10T13:00:00.000Z"), TZ, "en");
    expect(said.weekday).toBe("Thursday");
    // The machine-readable fields do not move with the language.
    expect(said.date).toBe("2026-09-10");
    expect(said.time).toBe("09:00");
  });
});

describe("spokenDay", () => {
  it("names the weekday of a date with no meaningful time", () => {
    const said = spokenDay(new Date("2026-09-10T13:00:00.000Z"), TZ);
    expect(said.weekday).toBe("jueves");
    expect(said.date).toBe("2026-09-10");
    expect(said.when).toContain("10");
  });
});

describe("null tolerance", () => {
  it("passes absence through, since most of these columns are nullable", () => {
    expect(spokenInstantOrNull(null, TZ)).toBeNull();
    expect(spokenInstantOrNull(undefined, TZ)).toBeNull();
    expect(spokenDayOrNull(null, TZ)).toBeNull();
  });
});
