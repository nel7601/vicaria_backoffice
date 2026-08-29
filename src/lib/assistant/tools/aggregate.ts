import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  appointments,
  careShifts,
  employees,
  encounters,
  invoices,
  patients,
  payments,
  services,
} from "@/lib/db/schema";
import { principalReadScope } from "@/lib/auth/authorize-principal";
import { planRead } from "../policy/scope";
import { dateSpecSchema, resolveDate } from "./resolve-date";
import type { AssistantTool, ToolContext } from "./types";

/**
 * `aggregate` — counts and sums the database computes, not the model.
 *
 * The alternative designs both fail. One tool per question ("revenue this
 * month", "appointments by practitioner") is always one question short of
 * what someone actually asks. Handing the model the rows to add up fails
 * worse: with volume they do not fit, and a model summing hundreds of amounts
 * gets it wrong silently — which is the one failure mode that matters, because
 * a wrong total looks exactly like a right one.
 *
 * So the model picks a metric, a range and a grouping, and Postgres does the
 * arithmetic. Exact by construction, and it covers combinations nobody
 * enumerated.
 *
 * Every metric states its own definition in the result. "Billed" is not
 * obvious — does a draft count? a voided invoice? — and an agent that reports
 * a number without saying what it counted is inviting a misunderstanding.
 */

const METRICS = [
  "revenue_collected",
  "amount_billed",
  "amount_outstanding",
  "appointments",
  "patients_seen",
  "new_patients",
  "care_shifts",
  "encounters_signed",
] as const;

const GROUPINGS = [
  "none",
  "day",
  "week",
  "month",
  "practitioner",
  "service",
  "status",
  "payment_method",
] as const;

const inputSchema = z.object({
  metric: z.enum(METRICS),
  range: dateSpecSchema,
  groupBy: z.enum(GROUPINGS).default("none"),
  /** Narrow to the caller's own work, where the metric has an owner. */
  who: z.enum(["anyone", "mine"]).default("anyone"),
});

type Input = z.infer<typeof inputSchema>;

/**
 * What each metric counts, in words the agent can repeat to the user.
 *
 * These are the definitions the clinical and finance teams need to agree with
 * (§4.3 of the plan). Written down here so that agreeing means changing one
 * line, and so nobody has to read SQL to know what a number means.
 */
const DEFINITIONS: Record<(typeof METRICS)[number], string> = {
  revenue_collected:
    "Confirmed payments received in the range. Excludes pending, failed and cancelled payments. Refunds are not subtracted.",
  amount_billed:
    "Total of invoices issued in the range. Excludes drafts (not yet issued) and voided invoices.",
  amount_outstanding:
    "Open balance of invoices issued in the range: what is still owed today, not what was billed.",
  appointments:
    "Appointments whose start falls in the range, excluding cancelled, no-show and rescheduled.",
  patients_seen:
    "Distinct patients with a completed appointment in the range. One patient counts once however many visits.",
  new_patients: "Patients created in the range.",
  care_shifts: "Home care shifts whose start falls in the range.",
  encounters_signed: "Clinical encounters signed in the range.",
};

/** Which permission each metric reads through. */
const RESOURCE: Record<(typeof METRICS)[number], "invoices_payments" | "patients_demographic" | "home_care" | "clinical_reports"> = {
  revenue_collected: "invoices_payments",
  amount_billed: "invoices_payments",
  amount_outstanding: "invoices_payments",
  appointments: "patients_demographic",
  patients_seen: "patients_demographic",
  new_patients: "patients_demographic",
  care_shifts: "home_care",
  encounters_signed: "clinical_reports",
};

export const aggregateTool: AssistantTool<Input, unknown> = {
  name: "aggregate",
  description:
    "Count or total something over a date range, optionally grouped. Use this for any " +
    "'how much', 'how many' or 'per month/practitioner/method' question — never add up " +
    "rows yourself. Metrics: revenue_collected, amount_billed, amount_outstanding, " +
    "appointments, patients_seen, new_patients, care_shifts, encounters_signed. " +
    "Amounts are in cents. The result states what the metric counted; repeat that to the user.",
  // The floor; each metric checks its own resource below.
  resource: null,
  action: "read",
  input: inputSchema,

  isAvailable(principal) {
    return METRICS.some(
      (m) => principalReadScope(principal, RESOURCE[m]) !== "none",
    );
  },

  async execute(args, ctx: ToolContext) {
    const resource = RESOURCE[args.metric];
    const plan = planRead(ctx.principal, resource);
    if (plan.mode === "denied") {
      return { refused: true, reason: plan.reason };
    }

    const range = resolveDate(args.range, ctx.now, ctx.timeZone);
    const db = getDb();
    const orgId = ctx.principal.organizationId;

    // A role limited to its own records is limited here too: an aggregate over
    // everyone would be exactly the disclosure the scope exists to prevent.
    const mine =
      (plan.mode === "own" || args.who === "mine"
        ? ctx.principal.employeeId
        : undefined) ?? undefined;
    if (plan.mode === "own" && !mine) {
      return { refused: true, reason: plan.reason };
    }

    const rows = await runMetric(args, range, orgId, mine, db);

    return {
      metric: args.metric,
      definition: DEFINITIONS[args.metric],
      range: { start: range.startDay, end: range.endDay, timeZone: range.timeZone },
      groupBy: args.groupBy,
      scope: mine ? "your own records" : "the whole clinic",
      currency: isMoney(args.metric) ? "CAD" : undefined,
      unit: isMoney(args.metric) ? "cents" : "count",
      total: rows.reduce((sum, r) => sum + Number(r.value), 0),
      // Absent when there is no grouping: a single total needs no breakdown.
      groups: (args.groupBy ?? "none") === "none" ? undefined : rows,
    };
  },
};

function isMoney(metric: (typeof METRICS)[number]): boolean {
  return metric.startsWith("revenue") || metric.startsWith("amount");
}

type Row = { group: string; value: number };

/**
 * Run a query, grouping only when there is something to group by.
 *
 * Postgres rejects a constant in GROUP BY, so "no grouping" cannot be faked
 * with a literal — it has to mean no GROUP BY clause at all.
 */
async function collect(
  base: { groupBy: (g: never) => unknown },
  grouping: unknown,
  grouped: boolean,
): Promise<Row[]> {
  const rows = (await (grouped
    ? base.groupBy(grouping as never)
    : (base as unknown as Promise<unknown>))) as unknown[];
  return (rows as { group?: unknown; value?: unknown }[]).map(toRow);
}

async function runMetric(
  args: Input,
  range: ReturnType<typeof resolveDate>,
  orgId: string,
  mine: string | undefined,
  db: ReturnType<typeof getDb>,
): Promise<Row[]> {
  const metric = args.metric;
  // Normalised rather than trusted: the schema supplies a default, but a
  // caller reaching this directly with it missing would otherwise group by a
  // constant, which Postgres rejects outright.
  const groupBy = args.groupBy ?? "none";
  const grouped = groupBy !== "none";

  switch (metric) {
    case "revenue_collected": {
      const g = moneyGrouping(groupBy, payments.receivedAt, payments.method);
      const base = db
        .select({ group: g, value: sql<number>`coalesce(sum(${payments.amountCents}), 0)::bigint` })
        .from(payments)
        .where(
          and(
            eq(payments.organizationId, orgId),
            eq(payments.status, "confirmed"),
            gte(payments.receivedAt, range.from),
            lt(payments.receivedAt, range.to),
          ),
        );
      return collect(base, g, grouped);
    }

    case "amount_billed":
    case "amount_outstanding": {
      const column =
        metric === "amount_billed" ? invoices.totalCents : invoices.balanceCents;
      const g = moneyGrouping(groupBy, invoices.issuedAt, invoices.status);
      const base = db
        .select({ group: g, value: sql<number>`coalesce(sum(${column}), 0)::bigint` })
        .from(invoices)
        .where(
          and(
            eq(invoices.organizationId, orgId),
            // A draft was never billed and a void was unbilled.
            ne(invoices.status, "draft"),
            ne(invoices.status, "void"),
            gte(invoices.issuedAt, range.from),
            lt(invoices.issuedAt, range.to),
          ),
        );
      return collect(base, g, grouped);
    }

    case "appointments":
    case "patients_seen": {
      const g = appointmentGrouping(groupBy);
      const value =
        metric === "patients_seen"
          ? sql<number>`count(distinct ${appointments.patientId})::bigint`
          : sql<number>`count(*)::bigint`;

      const conditions = [
        eq(appointments.organizationId, orgId),
        gte(appointments.startAt, range.from),
        lt(appointments.startAt, range.to),
      ];
      if (metric === "patients_seen") {
        conditions.push(eq(appointments.status, "completed"));
      } else {
        for (const dead of ["cancelled", "no_show", "rescheduled"] as const) {
          conditions.push(ne(appointments.status, dead));
        }
      }
      if (mine) conditions.push(eq(appointments.employeeId, mine));

      const base = db
        .select({ group: g, value })
        .from(appointments)
        .leftJoin(employees, eq(employees.id, appointments.employeeId))
        .leftJoin(services, eq(services.id, appointments.serviceId))
        .where(and(...conditions));
      return collect(base, g, grouped);
    }

    case "new_patients": {
      const g = periodGrouping(groupBy, patients.createdAt);
      const base = db
        .select({ group: g, value: sql<number>`count(*)::bigint` })
        .from(patients)
        .where(
          and(
            eq(patients.organizationId, orgId),
            gte(patients.createdAt, range.from),
            lt(patients.createdAt, range.to),
          ),
        );
      return collect(base, g, grouped);
    }

    case "care_shifts": {
      const g =
        groupBy === "status"
          ? sql<string>`${careShifts.status}::text`
          : periodGrouping(groupBy, careShifts.startAt);
      const conditions = [
        eq(careShifts.organizationId, orgId),
        gte(careShifts.startAt, range.from),
        lt(careShifts.startAt, range.to),
      ];
      if (mine) conditions.push(eq(careShifts.caregiverId, mine));
      const base = db
        .select({ group: g, value: sql<number>`count(*)::bigint` })
        .from(careShifts)
        .where(and(...conditions));
      return collect(base, g, grouped);
    }

    case "encounters_signed": {
      const g = periodGrouping(groupBy, encounters.signedAt);
      const conditions = [
        eq(encounters.organizationId, orgId),
        gte(encounters.signedAt, range.from),
        lt(encounters.signedAt, range.to),
      ];
      if (mine) conditions.push(eq(encounters.practitionerId, mine));
      const base = db
        .select({ group: g, value: sql<number>`count(*)::bigint` })
        .from(encounters)
        .where(and(...conditions));
      return collect(base, g, grouped);
    }
  }
}

function toRow(r: { group?: unknown; value?: unknown }): Row {
  return { group: String(r.group ?? "—"), value: Number(r.value ?? 0) };
}

/**
 * Dates are bucketed in clinic time, or an evening appointment lands on the
 * wrong day — the same reason every date in this system goes through the
 * timezone helpers rather than UTC.
 */
function periodGrouping(groupBy: string, at: AnyPgColumn) {
  switch (groupBy) {
    case "day":
      return sql<string>`to_char(${at} at time zone 'America/Toronto', 'YYYY-MM-DD')`;
    case "week":
      return sql<string>`to_char(date_trunc('week', ${at} at time zone 'America/Toronto'), 'YYYY-MM-DD')`;
    case "month":
      return sql<string>`to_char(${at} at time zone 'America/Toronto', 'YYYY-MM')`;
    default:
      // Never reached when grouping is off; collect() skips GROUP BY entirely.
      return sql<string>`'total'`;
  }
}

function moneyGrouping(groupBy: string, at: AnyPgColumn, categorical: AnyPgColumn) {
  if (groupBy === "payment_method" || groupBy === "status") {
    return sql<string>`${categorical}::text`;
  }
  return periodGrouping(groupBy, at);
}

function appointmentGrouping(groupBy: string) {
  switch (groupBy) {
    case "practitioner":
      return sql<string>`coalesce(${employees.firstName} || ' ' || ${employees.lastName}, 'unknown')`;
    case "service":
      return sql<string>`coalesce(${services.nameEn}, 'none')`;
    case "status":
      return sql<string>`${appointments.status}::text`;
    default:
      return periodGrouping(groupBy, appointments.startAt);
  }
}
