import { z } from "zod";
import { clinicNow, dateSpecSchema, resolveDate } from "./resolve-date";

/**
 * The spec is wrapped in an object rather than passed bare.
 *
 * Two reasons, and both are about the caller rather than us. A tool's
 * parameters must be a JSON Schema object at the root — a bare discriminated
 * union renders as `anyOf` and OpenAI-compatible providers reject the tool
 * outright. And every other tool already takes its date as `range`, so this
 * keeps one shape for the model to learn instead of two.
 */
const inputSchema = z.object({ range: dateSpecSchema });

type Input = z.infer<typeof inputSchema>;
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
  Input,
  ReturnType<typeof describeRange>
> = {
  name: "resolve_date",
  description:
    "Convert a date expression the user said into absolute dates in the clinic's timezone. " +
    "Classify the phrase into one of the supported shapes; never compute dates yourself. " +
    "Always state the resolved date back to the user before acting on it.",
  resource: null,
  action: "read",
  input: inputSchema,
  async execute(args, ctx: ToolContext) {
    const range = resolveDate(args.range, ctx.now, ctx.timeZone);
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
