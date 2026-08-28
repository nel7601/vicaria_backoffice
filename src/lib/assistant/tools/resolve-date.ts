import { z } from "zod";
import {
  CLINIC_TZ,
  clinicDateString,
  clinicDayWindow,
  clinicMonthString,
  clinicMonthWindow,
  clinicWeekWindow,
  shiftDay,
  shiftMonth,
  weekStartDay,
  zonedMidnightUtc,
} from "@/lib/domain/timezone";

/**
 * Date resolution for the assistant (§4.3 of the assistant plan).
 *
 * The model is good at reading "el próximo viernes" and bad at arithmetic on
 * it — especially across DST, month ends and year ends, where an off-by-one
 * silently answers about the wrong day. So the split is: the model classifies
 * the phrase into one of the shapes below, and the server does every date
 * calculation from the clinic's current time.
 *
 * This is why the input is a structured spec rather than free text. A parser
 * for Spanish and English date phrases would be the fragile part of the system
 * and would put the arithmetic back where it does not belong.
 *
 * Every result is a half-open [from, to) UTC window plus the absolute days it
 * covers, so the agent can always state the date it actually used.
 */

export const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

export const dateSpecSchema = z.discriminatedUnion("kind", [
  /** "hoy", "mañana", "anteayer" — offset in days from today. */
  z.object({ kind: z.literal("day"), offsetDays: z.int().min(-366).max(366) }),
  /**
   * "el próximo viernes" / "el viernes pasado". `direction: "next"` is the
   * coming occurrence, never today: asked on a Friday, "next Friday" means the
   * one in seven days, which is what people mean and what the model gets wrong.
   */
  z.object({
    kind: z.literal("weekday"),
    weekday: z.enum(WEEKDAYS),
    direction: z.enum(["next", "last"]),
  }),
  /** An absolute day the model already resolved, e.g. from "el 8 de mayo". */
  z.object({ kind: z.literal("date"), date: dayString }),
  /** "esta semana" (0), "la semana que viene" (1). Weeks start on Sunday. */
  z.object({ kind: z.literal("week"), offsetWeeks: z.int().min(-104).max(104) }),
  /** "este mes" (0), "el mes pasado" (-1). Calendar months in clinic time. */
  z.object({ kind: z.literal("month"), offsetMonths: z.int().min(-120).max(120) }),
  /**
   * "este año" (0), "el año pasado" (-1).
   *
   * Added after a live run: asked how many patients had been seen this year,
   * the model correctly refused rather than inventing a range, because there
   * was no shape for it. A refusal to a reasonable question is still a wrong
   * answer.
   */
  z.object({ kind: z.literal("year"), offsetYears: z.int().min(-50).max(50) }),
  /** An explicit inclusive range of days. */
  z.object({ kind: z.literal("range"), from: dayString, to: dayString }),
]);

export type DateSpec = z.infer<typeof dateSpecSchema>;

export interface ResolvedRange {
  /** Inclusive first day covered, YYYY-MM-DD in clinic time. */
  startDay: string;
  /** Inclusive last day covered, YYYY-MM-DD in clinic time. */
  endDay: string;
  /** Half-open UTC window for querying: from <= t < to. */
  from: Date;
  to: Date;
  timeZone: string;
  /** How the agent should name this range out loud, in absolute terms. */
  label: string;
}

function dayRange(startDay: string, endDay: string, timeZone: string): ResolvedRange {
  return {
    startDay,
    endDay,
    from: zonedMidnightUtc(startDay, timeZone),
    to: zonedMidnightUtc(shiftDay(endDay, 1), timeZone),
    timeZone,
    label: startDay === endDay ? startDay : `${startDay} to ${endDay}`,
  };
}

export class DateResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DateResolutionError";
  }
}

/**
 * Resolve a spec against the clinic's current time.
 *
 * `now` is injected rather than read from the clock so that the tool is
 * testable and so a turn resolves every date against one consistent instant.
 */
export function resolveDate(
  spec: DateSpec,
  now: Date,
  timeZone: string = CLINIC_TZ,
): ResolvedRange {
  const today = clinicDateString(now, timeZone);

  switch (spec.kind) {
    case "day": {
      const day = shiftDay(today, spec.offsetDays);
      return dayRange(day, day, timeZone);
    }

    case "weekday": {
      const target = WEEKDAYS.indexOf(spec.weekday);
      const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
      let delta =
        spec.direction === "next"
          ? (target - todayDow + 7) % 7
          : -(((todayDow - target + 7) % 7));
      // Landing on today means the phrase pointed at the other week.
      if (delta === 0) delta = spec.direction === "next" ? 7 : -7;
      const day = shiftDay(today, delta);
      return dayRange(day, day, timeZone);
    }

    case "date":
      return dayRange(spec.date, spec.date, timeZone);

    case "week": {
      const anchor = shiftDay(today, spec.offsetWeeks * 7);
      const { from, to, weekStart } = clinicWeekWindow(anchor, timeZone);
      return {
        startDay: weekStart,
        endDay: shiftDay(weekStart, 6),
        from,
        to,
        timeZone,
        label: `week of ${weekStart}`,
      };
    }

    case "month": {
      const month = shiftMonth(clinicMonthString(now, timeZone), spec.offsetMonths);
      const { from, to } = clinicMonthWindow(month, timeZone);
      const endDay = shiftDay(`${shiftMonth(month, 1)}-01`, -1);
      return {
        startDay: `${month}-01`,
        endDay,
        from,
        to,
        timeZone,
        label: month,
      };
    }

    case "year": {
      const year = Number(today.slice(0, 4)) + spec.offsetYears;
      const startDay = `${year}-01-01`;
      const endDay = `${year}-12-31`;
      return {
        startDay,
        endDay,
        from: zonedMidnightUtc(startDay, timeZone),
        to: zonedMidnightUtc(`${year + 1}-01-01`, timeZone),
        timeZone,
        label: String(year),
      };
    }

    case "range": {
      if (spec.to < spec.from) {
        throw new DateResolutionError(
          "The end of the range falls before its start.",
        );
      }
      return dayRange(spec.from, spec.to, timeZone);
    }
  }
}

/** Today in the clinic timezone — what the orchestrator injects each turn. */
export function clinicNow(now: Date, timeZone: string = CLINIC_TZ) {
  const today = clinicDateString(now, timeZone);
  return {
    today,
    weekday: WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()],
    weekStart: weekStartDay(today),
    month: clinicMonthString(now, timeZone),
    timeZone,
  };
}

/** The window a range covers, for tools that only need the day boundaries. */
export function dayWindowOf(day: string, timeZone: string = CLINIC_TZ) {
  return clinicDayWindow(day, timeZone);
}
