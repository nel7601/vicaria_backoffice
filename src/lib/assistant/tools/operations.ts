import { and, asc, eq, isNotNull, lte, ne, notInArray } from "drizzle-orm";
import { z } from "zod";
import { recordAccess } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import { employees, followUpTasks, invoices, patients } from "@/lib/db/schema";
import { listShiftsInWindow } from "@/lib/db/queries/care";
import { planRead } from "../policy/scope";
import { dateSpecSchema, resolveDate } from "./resolve-date";
import type { AssistantTool, ToolContext } from "./types";
import { localeOf, spokenDayOrNull, spokenInstant } from "./when";

/**
 * Home care, follow-up tasks and invoices (§4.3 of the assistant plan).
 *
 * Each sits behind its own resource, so the registry offers them only to roles
 * that hold that permission: billing sees invoices and not the care roster,
 * a caregiver the other way round.
 */

const rangeInput = z.object({
  range: dateSpecSchema,
  who: z.enum(["anyone", "mine"]).default("anyone"),
});

export const getCareShiftsForRangeTool: AssistantTool<
  z.infer<typeof rangeInput>,
  unknown
> = {
  name: "get_care_shifts_for_range",
  description:
    "List home-care shifts in a date range: times, caregiver, client and status. " +
    "Use it for questions about the care roster ('who is covering tomorrow', 'what shifts do I have').",
  resource: "home_care",
  action: "read",
  input: rangeInput,

  async execute(args, ctx: ToolContext) {
    const plan = planRead(ctx.principal, "home_care");
    if (plan.mode === "denied") return { refused: true, reason: plan.reason };

    const range = resolveDate(args.range, ctx.now, ctx.timeZone);
    const caregiverId =
      plan.mode === "own"
        ? plan.employeeId
        : args.who === "mine"
          ? (ctx.principal.employeeId ?? undefined)
          : undefined;

    if (plan.mode === "own" && !caregiverId) {
      return { refused: true, reason: plan.reason };
    }

    const shifts = await listShiftsInWindow({
      organizationId: ctx.principal.organizationId,
      from: range.from,
      to: range.to,
      caregiverId,
    });

    if (!plan.identifiable) {
      return {
        range: { start: range.startDay, end: range.endDay },
        count: shifts.length,
        note: "This role sees shift times only, without client identities.",
      };
    }

    await Promise.all(
      [...new Set(shifts.map((s) => s.patientId))].map((patientId) =>
        recordAccess({
          organizationId: ctx.principal.organizationId,
          actorUserId: ctx.principal.dbUserId,
          patientId,
          action: "assistant_read",
          route: "assistant:get_care_shifts_for_range",
          purpose: "Assistant answered a care roster question",
        }),
      ),
    );

    return {
      range: { start: range.startDay, end: range.endDay, timeZone: range.timeZone },
      count: shifts.length,
      scope: caregiverId ? "your own shifts" : "the whole clinic",
      shifts: shifts.map((s) => ({
        shiftId: s.id,
        start: spokenInstant(s.startAt, ctx.timeZone, localeOf(ctx)),
        end: spokenInstant(s.endAt, ctx.timeZone, localeOf(ctx)),
        status: s.status,
        caregiver: `${s.caregiverFirst} ${s.caregiverLast}`.trim(),
        client: `${s.patientFirst} ${s.patientLast}`.trim(),
        patientId: s.patientId,
      })),
    };
  },
};

const tasksInput = z.object({
  /** Overdue only, by default: the question is almost always "what's late". */
  scope: z.enum(["overdue", "open", "all"]).default("overdue"),
  who: z.enum(["anyone", "mine"]).default("mine"),
});

export const getFollowUpTasksTool: AssistantTool<
  z.infer<typeof tasksInput>,
  unknown
> = {
  name: "get_follow_up_tasks",
  description:
    "List follow-up tasks: what is overdue, what is still open, who it is for and which patient. " +
    "Defaults to the caller's own overdue tasks.",
  resource: "patients_demographic",
  action: "read",
  input: tasksInput,

  async execute(args, ctx: ToolContext) {
    const plan = planRead(ctx.principal, "patients_demographic");
    if (plan.mode === "denied" || !plan.identifiable) {
      return {
        refused: true,
        reason: plan.reason ?? "This role cannot see follow-up tasks.",
      };
    }

    const db = getDb();
    const conditions = [
      eq(followUpTasks.organizationId, ctx.principal.organizationId),
    ];

    const assignee =
      plan.mode === "own"
        ? plan.employeeId
        : args.who === "mine"
          ? (ctx.principal.employeeId ?? undefined)
          : undefined;
    if (plan.mode === "own" && !assignee) {
      return { refused: true, reason: plan.reason };
    }
    if (assignee) conditions.push(eq(followUpTasks.assignedTo, assignee));

    if (args.scope !== "all") {
      // Anything not finished, either way it finished.
      conditions.push(notInArray(followUpTasks.status, ["completed", "cancelled"]));
    }
    if (args.scope === "overdue") {
      // Overdue means it had a date and the date has passed.
      conditions.push(isNotNull(followUpTasks.dueDate));
      conditions.push(lte(followUpTasks.dueDate, ctx.now));
    }

    const rows = await db
      .select({
        id: followUpTasks.id,
        title: followUpTasks.title,
        taskType: followUpTasks.taskType,
        dueDate: followUpTasks.dueDate,
        priority: followUpTasks.priority,
        status: followUpTasks.status,
        patientId: followUpTasks.patientId,
        patientFirst: patients.legalFirstName,
        patientLast: patients.legalLastName,
        assigneeFirst: employees.firstName,
        assigneeLast: employees.lastName,
      })
      .from(followUpTasks)
      .innerJoin(patients, eq(patients.id, followUpTasks.patientId))
      .leftJoin(employees, eq(employees.id, followUpTasks.assignedTo))
      .where(and(...conditions))
      .orderBy(asc(followUpTasks.dueDate))
      .limit(50);

    await Promise.all(
      [...new Set(rows.map((r) => r.patientId))].map((patientId) =>
        recordAccess({
          organizationId: ctx.principal.organizationId,
          actorUserId: ctx.principal.dbUserId,
          patientId,
          action: "assistant_read",
          route: "assistant:get_follow_up_tasks",
          purpose: "Assistant listed follow-up tasks",
        }),
      ),
    );

    return {
      scope: args.scope,
      forWhom: assignee ? "you" : "the whole clinic",
      count: rows.length,
      tasks: rows.map((r) => ({
        taskId: r.id,
        title: r.title,
        type: r.taskType ?? undefined,
        dueDate: spokenDayOrNull(r.dueDate, ctx.timeZone, localeOf(ctx)),
        priority: r.priority,
        status: r.status,
        patientId: r.patientId,
        patient: `${r.patientFirst} ${r.patientLast}`.trim(),
        assignedTo:
          r.assigneeFirst ? `${r.assigneeFirst} ${r.assigneeLast}`.trim() : null,
      })),
    };
  },
};

const invoicesInput = z.object({
  /** Unpaid is the question people actually ask. */
  filter: z.enum(["outstanding", "overdue", "all"]).default("outstanding"),
  patientId: z.uuid().optional(),
});

export const getInvoicesTool: AssistantTool<
  z.infer<typeof invoicesInput>,
  unknown
> = {
  name: "get_invoices",
  description:
    "List invoices with their balances: outstanding, overdue, or all. " +
    "Optionally for one patient. Amounts are in cents.",
  resource: "invoices_payments",
  action: "read",
  input: invoicesInput,

  async execute(args, ctx: ToolContext) {
    const plan = planRead(ctx.principal, "invoices_payments");
    if (plan.mode === "denied") return { refused: true, reason: plan.reason };

    const db = getDb();
    const conditions = [
      eq(invoices.organizationId, ctx.principal.organizationId),
      ne(invoices.status, "void"),
    ];
    if (args.patientId) conditions.push(eq(invoices.patientId, args.patientId));
    if (args.filter !== "all") {
      conditions.push(ne(invoices.balanceCents, 0));
    }
    if (args.filter === "overdue") {
      conditions.push(isNotNull(invoices.dueDate));
      conditions.push(lte(invoices.dueDate, ctx.now));
    }

    const rows = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        totalCents: invoices.totalCents,
        balanceCents: invoices.balanceCents,
        currency: invoices.currency,
        dueDate: invoices.dueDate,
        patientId: invoices.patientId,
        patientFirst: patients.legalFirstName,
        patientLast: patients.legalLastName,
      })
      .from(invoices)
      .innerJoin(patients, eq(patients.id, invoices.patientId))
      .where(and(...conditions))
      .orderBy(asc(invoices.dueDate))
      .limit(50);

    const outstanding = rows.reduce((sum, r) => sum + r.balanceCents, 0);

    // A finance-only role sees the money without the names attached.
    if (!plan.identifiable) {
      return {
        filter: args.filter,
        count: rows.length,
        outstandingCents: outstanding,
        currency: rows[0]?.currency ?? "CAD",
        note: "This role sees totals only, without patient identities.",
      };
    }

    await Promise.all(
      [...new Set(rows.map((r) => r.patientId))].map((patientId) =>
        recordAccess({
          organizationId: ctx.principal.organizationId,
          actorUserId: ctx.principal.dbUserId,
          patientId,
          action: "assistant_read",
          route: "assistant:get_invoices",
          purpose: "Assistant answered a billing question",
        }),
      ),
    );

    return {
      filter: args.filter,
      count: rows.length,
      outstandingCents: outstanding,
      currency: rows[0]?.currency ?? "CAD",
      invoices: rows.map((r) => ({
        invoiceId: r.id,
        number: r.invoiceNumber,
        status: r.status,
        totalCents: r.totalCents,
        balanceCents: r.balanceCents,
        dueDate: spokenDayOrNull(r.dueDate, ctx.timeZone, localeOf(ctx)),
        patientId: r.patientId,
        patient: `${r.patientFirst} ${r.patientLast}`.trim(),
      })),
    };
  },
};
