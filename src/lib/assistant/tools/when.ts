import type { ToolContext } from "./types";

/**
 * Times a model can read out without doing arithmetic.
 *
 * Every tool used to hand back `startAt: "2026-09-10T13:00:00.000Z"` and the
 * timezone in a separate field, which quietly made the model responsible for
 * two calculations it is bad at: subtracting the UTC offset (and knowing
 * whether it is EDT or EST that week), and deriving a weekday from a date.
 *
 * On 2026-09-05 it got both wrong on the air. Asked for next week's
 * appointments it named three weekdays, all of them one day early, and read
 * 13:00Z as "one in the afternoon" when in Toronto it was nine in the morning
 * — while converting the other two correctly, which is the worst possible
 * outcome: right often enough to be believed.
 *
 * The system prompt already says "never compute a date yourself". That rule
 * was unfollowable while the only thing on offer was UTC: answering *required*
 * the computation. So the server does it — it has a real timezone database and
 * no opinions — and the model is left with a sentence to read.
 *
 * `iso` stays because ids and instants are still how a follow-up tool call
 * refers to the same appointment. It is for machines; `when` is for mouths.
 */
export interface SpokenInstant {
  /** Ready to say aloud: "jueves, 10 de septiembre, 9:00". */
  when: string;
  /** YYYY-MM-DD in the clinic's timezone — the day it really falls on. */
  date: string;
  /** "jueves" / "Thursday". Never inferred by the model again. */
  weekday: string;
  /** 24-hour clinic-local time, "09:00". */
  time: string;
  timeZone: string;
  /** The underlying UTC instant, for anything that has to round-trip. */
  iso: string;
}

/** A day with no time of day: an invoice due date, a plan's start. */
export interface SpokenDay {
  /** "jueves, 10 de septiembre". */
  when: string;
  date: string;
  weekday: string;
  timeZone: string;
}

type Locale = "es" | "en";

function tag(locale: Locale): string {
  return locale === "es" ? "es-CA" : "en-CA";
}

/** Parts of an instant as they read in a given timezone. */
function partsIn(at: Date, timeZone: string, locale: Locale) {
  const get = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(tag(locale), { timeZone, ...options }).format(at);

  // en-CA formats a plain date as YYYY-MM-DD, which is the shape every other
  // date in this codebase uses; asking for it explicitly keeps `date` stable
  // regardless of the caller's locale.
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);

  return {
    date,
    weekday: get({ weekday: "long" }),
    time: new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at),
    dayAndMonth: get({ weekday: "long", day: "numeric", month: "long" }),
    hourSpoken: get({ hour: "numeric", minute: "2-digit" }),
  };
}

/** An instant, said the way the clinic says it. */
export function spokenInstant(
  at: Date,
  timeZone: string,
  locale: Locale = "es",
): SpokenInstant {
  const p = partsIn(at, timeZone, locale);
  return {
    when: `${p.dayAndMonth}, ${p.hourSpoken}`,
    date: p.date,
    weekday: p.weekday,
    time: p.time,
    timeZone,
    iso: at.toISOString(),
  };
}

/** The same for a date that carries no meaningful time of day. */
export function spokenDay(
  at: Date,
  timeZone: string,
  locale: Locale = "es",
): SpokenDay {
  const p = partsIn(at, timeZone, locale);
  return { when: p.dayAndMonth, date: p.date, weekday: p.weekday, timeZone };
}

/** Null-tolerant wrappers: most of these columns are nullable. */
export function spokenInstantOrNull(
  at: Date | null | undefined,
  timeZone: string,
  locale: Locale = "es",
): SpokenInstant | null {
  return at ? spokenInstant(at, timeZone, locale) : null;
}

export function spokenDayOrNull(
  at: Date | null | undefined,
  timeZone: string,
  locale: Locale = "es",
): SpokenDay | null {
  return at ? spokenDay(at, timeZone, locale) : null;
}

/** Locale of the person being answered, defaulting to the clinic's Spanish. */
export function localeOf(ctx: ToolContext): Locale {
  return ctx.principal.locale === "en" ? "en" : "es";
}
