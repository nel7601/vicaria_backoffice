import { z } from "zod";
import { principalCan } from "@/lib/auth/authorize-principal";
import { runReport } from "@/lib/db/queries/reports";
import { getReport, reportsForRoles } from "@/lib/reports/registry";
import { recordAudit } from "@/lib/audit/record";
import { dateSpecSchema, resolveDate } from "./resolve-date";
import type { Principal } from "@/lib/auth/principal";
import type { AssistantTool, ToolContext } from "./types";

/**
 * Reports this principal may run.
 *
 * Deliberately the web's own catalogue, filtered by the same matrix, so voice
 * and screen agree. Note the consequence: a role whose scope on a resource is
 * "aggregate" — marketing on billing — is offered that resource's reports,
 * which is correct while every one of them returns aggregates. A future report
 * on the same resource that listed patients would be offered too, and the
 * registry has no way to tell the difference. That guard belongs in the
 * registry, next to `aggregated`, not here.
 */
function availableReports(principal: Principal) {
  return reportsForRoles(principal.roles).filter((r) =>
    principalCan(principal, r.resource, "read"),
  );
}

/**
 * `run_report` — the predefined reports, spoken (§4.3).
 *
 * Reuses the web's report registry, so a report is available to the assistant
 * exactly when it is available on the reports page for that role. A new report
 * added there is offered here with no change, and one restricted there is
 * restricted here — which is the only way the two stay in step.
 *
 * The catalogue is closed: the model chooses a code, never a query. Rows are
 * capped because a spoken answer that reads out 400 rows is not an answer.
 */

const MAX_ROWS = 50;

const inputSchema = z.object({
  /** A code from the catalogue, e.g. "FIN-01". Anything else is refused. */
  code: z.string().trim().min(3).max(20),
  range: dateSpecSchema.optional(),
});

type Input = z.infer<typeof inputSchema>;

export const runReportTool: AssistantTool<Input, unknown> = {
  name: "run_report",
  description:
    "Run one of the clinic's predefined reports by code and summarise its figures. " +
    "Call it with no code first to see which reports this user may run. " +
    "Reports return aggregates, not patient records.",
  // The registry gates each report by its own resource; this is the floor.
  resource: null,
  action: "read",
  input: inputSchema.partial({ code: true }) as z.ZodType<Input>,

  // Offered only when this principal has at least one report. principalCan
  // also folds in the MFA rule, which reportsForRoles alone does not know
  // about: a privileged role at aal1 has no reports, like it has nothing else.
  isAvailable(principal) {
    return availableReports(principal).length > 0;
  },

  async execute(args, ctx: ToolContext) {
    const available = availableReports(ctx.principal);

    // No code, or an unknown one: answer with the catalogue rather than an
    // error, so the model can pick a real report on the next turn.
    if (!args.code) {
      return {
        catalogue: available.map((r) => ({
          code: r.code,
          title: r.title,
          description: r.description,
        })),
      };
    }

    const code = args.code.toUpperCase();
    const def = getReport(code);

    // Unavailable and non-existent answer alike: which reports other roles can
    // run is not something to learn by guessing codes.
    if (!def || !available.some((r) => r.code === def.code)) {
      return {
        refused: true,
        reason: `No report "${code}" is available to you.`,
        catalogue: available.map((r) => ({ code: r.code, title: r.title })),
      };
    }

    const range = args.range
      ? resolveDate(args.range, ctx.now, ctx.timeZone)
      : undefined;

    const result = await runReport(def.code, ctx.principal.organizationId, {
      from: range?.from,
      to: range?.to,
    });

    // Reports are the bulk-data path, so running one is audited even though
    // nothing is exported (§10.3).
    await recordAudit({
      organizationId: ctx.principal.organizationId,
      actorUserId: ctx.principal.dbUserId,
      action: "report_run",
      entityType: "report",
      entityId: def.code,
      after: {
        source: "assistant",
        rows: result.rows.length,
        range: range ? { from: range.startDay, to: range.endDay } : "all time",
      },
    });

    const truncated = result.rows.length > MAX_ROWS;

    return {
      code: def.code,
      title: def.title,
      aggregated: def.aggregated ?? false,
      range: range
        ? { start: range.startDay, end: range.endDay, timeZone: range.timeZone }
        : "all time",
      columns: result.columns,
      rows: result.rows.slice(0, MAX_ROWS),
      rowCount: result.rows.length,
      truncated,
      notes: result.notes,
      guidance: truncated
        ? `Only the first ${MAX_ROWS} rows are shown. Summarise them; do not read them out one by one.`
        : "Summarise these figures rather than reading every row.",
    };
  },
};
