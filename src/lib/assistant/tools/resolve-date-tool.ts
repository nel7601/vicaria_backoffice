import { z } from "zod";
import { clinicNow, dateSpecSchema, resolveDate } from "./resolve-date";
import type { AssistantTool, ToolContext } from "./types";

/**
 * `resolve_date` — turn a classified date phrase into absolute clinic dates.
 *
 * Reads nothing, so it carries no resource permission: it is arithmetic over
 * the turn's current time. Its output is what the agent must say out loud
 * ("Tuesday the 8th"), so the user can catch a misread before anything acts on
 * it.
 */
export const resolveDateTool: AssistantTool<
  z.infer<typeof dateSpecSchema>,
  ReturnType<typeof describeRange>
> = {
  name: "resolve_date",
  description:
    "Convert a date expression the user said into absolute dates in the clinic's timezone. " +
    "Classify the phrase into one of the supported shapes; never compute dates yourself. " +
    "Always state the resolved date back to the user before acting on it.",
  resource: null,
  action: "read",
  input: dateSpecSchema,
  async execute(args, ctx: ToolContext) {
    const range = resolveDate(args, ctx.now, ctx.timeZone);
    return describeRange(range, ctx);
  },
};

function describeRange(
  range: ReturnType<typeof resolveDate>,
  ctx: ToolContext,
) {
  return {
    startDay: range.startDay,
    endDay: range.endDay,
    label: range.label,
    timeZone: range.timeZone,
    /** Current clinic date, so the model never has to guess "today". */
    resolvedFrom: clinicNow(ctx.now, ctx.timeZone),
  };
}
