import { and, asc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { recordAccess } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import { appointments, employees, patients, services } from "@/lib/db/schema";
import { planRead } from "../policy/scope";
import { dateSpecSchema, resolveDate } from "./resolve-date";
import type { AssistantTool, ToolContext } from "./types";

/**
 * `get_appointments_for_range` — the schedule for a day or range (§4.3).
 *
 * Reuses the same tenant/scope reasoning as the web, not the web's query: the
 * query here has to apply the caller's read plan itself, because the Drizzle
 * client does not carry the user's JWT claims and so RLS is not representing
 * the mobile caller on this connection.
 */

const CANCELLED_STATUSES = ["cancelled", "no_show", "rescheduled"] as const;

const inputSchema = z.object({
  range: dateSpecSchema,
  /**
   * "mine" narrows to the caller's own appointments. Roles that can only see
   * their own are narrowed regardless of what is asked here.
   */
  who: z.enum(["anyone", "mine"]).default("anyone"),
  /** Cancelled and no-show appointments are excluded unless asked for. */
  includeCancelled: z.boolean().default(false),
});

type Input = z.infer<typeof inputSchema>;

export const getAppointmentsForRangeTool: AssistantTool<Input, unknown> = {
  name: "get_appointments_for_range",
  description:
    "List the appointments scheduled in a date range: times, patient, practitioner, service and status. " +
    "Use it for questions about the agenda ('what do I have on Friday', 'who is coming next week'). " +
    "Cancelled and no-show appointments are excluded unless explicitly requested.",
  resource: "patients_demographic",
  action: "read",
  input: inputSchema,

  async execute(args, ctx: ToolContext) {
    const plan = planRead(ctx.principal, "patients_demographic");
    if (plan.mode === "denied") {
      return { refused: true, reason: plan.reason };
    }

    const range = resolveDate(args.range, ctx.now, ctx.timeZone);
    const db = getDb();

    const conditions = [
      eq(appointments.organizationId, ctx.principal.organizationId),
      gte(appointments.startAt, range.from),
      lt(appointments.startAt, range.to),
    ];

    // The role's own limit wins over what the caller asked for.
    const employeeId =
      plan.mode === "own" ? plan.employeeId : args.who === "mine" ? ctx.principal.employeeId : undefined;
    if (plan.mode === "own" && !employeeId) {
      return { refused: true, reason: plan.reason };
    }
    if (employeeId) {
      conditions.push(eq(appointments.employeeId, employeeId));
    }
    if (!args.includeCancelled) {
      conditions.push(
        ...CANCELLED_STATUSES.map((status) => ne(appointments.status, status)),
      );
    }

    const rows = await db
      .select({
        id: appointments.id,
        startAt: appointments.startAt,
        endAt: appointments.endAt,
        status: appointments.status,
        modality: appointments.modality,
        patientId: appointments.patientId,
        patientFirst: patients.legalFirstName,
        patientLast: patients.legalLastName,
        practitionerFirst: employees.firstName,
        practitionerLast: employees.lastName,
        serviceName: services.nameEn,
      })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .innerJoin(employees, eq(employees.id, appointments.employeeId))
      .leftJoin(services, eq(services.id, appointments.serviceId))
      .where(and(...conditions))
      .orderBy(asc(appointments.startAt));

    // A caller who may not see identities gets the shape of the day, not who
    // is in it. Answering "you have four appointments" is still useful.
    if (!plan.identifiable) {
      return {
        range: { start: range.startDay, end: range.endDay, timeZone: range.timeZone },
        count: rows.length,
        appointments: rows.map((r) => ({
          startAt: r.startAt.toISOString(),
          endAt: r.endAt.toISOString(),
          status: r.status,
        })),
        note: "This role sees appointment times only, without patient identities.",
      };
    }

    // Reading a schedule is reading who the patients are: log it per patient
    // (§12.2), once each, before the data leaves the server.
    await logPatientAccess(ctx, [...new Set(rows.map((r) => r.patientId))]);

    return {
      range: { start: range.startDay, end: range.endDay, timeZone: range.timeZone },
      count: rows.length,
      scope: plan.mode === "own" ? "your own appointments" : "the whole clinic",
      appointments: rows.map((r) => ({
        appointmentId: r.id,
        startAt: r.startAt.toISOString(),
        endAt: r.endAt.toISOString(),
        status: r.status,
        modality: r.modality,
        patientId: r.patientId,
        patient: `${r.patientFirst} ${r.patientLast}`.trim(),
        practitioner: `${r.practitionerFirst} ${r.practitionerLast}`.trim(),
        service: r.serviceName ?? null,
      })),
    };
  },
};

/**
 * `count_completed_appointments` — an aggregate question answered with an
 * aggregate (§4.3: "count questions return counts, not lists of names").
 */
const countInput = z.object({
  range: dateSpecSchema,
  who: z.enum(["anyone", "mine"]).default("anyone"),
});

export const countCompletedAppointmentsTool: AssistantTool<
  z.infer<typeof countInput>,
  unknown
> = {
  name: "count_completed_appointments",
  description:
    "Count completed appointments in a date range, and how many distinct patients they involved. " +
    "Use this for 'how many patients did I see', 'how many appointments were completed'. " +
    "Returns numbers only — never names.",
  resource: "patients_demographic",
  action: "read",
  input: countInput,

  async execute(args, ctx: ToolContext) {
    const plan = planRead(ctx.principal, "patients_demographic");
    if (plan.mode === "denied") {
      return { refused: true, reason: plan.reason };
    }

    const range = resolveDate(args.range, ctx.now, ctx.timeZone);
    const db = getDb();

    const conditions = [
      eq(appointments.organizationId, ctx.principal.organizationId),
      gte(appointments.startAt, range.from),
      lt(appointments.startAt, range.to),
      // "Seen" means the appointment actually happened. This is the metric
      // definition the clinical team has to confirm before the agent is
      // trusted with it (§4.3, "contrato semántico de métricas").
      inArray(appointments.status, ["completed"]),
    ];

    const employeeId =
      plan.mode === "own" ? plan.employeeId : args.who === "mine" ? ctx.principal.employeeId : undefined;
    if (plan.mode === "own" && !employeeId) {
      return { refused: true, reason: plan.reason };
    }
    if (employeeId) {
      conditions.push(eq(appointments.employeeId, employeeId));
    }

    const rows = await db
      .select({ patientId: appointments.patientId })
      .from(appointments)
      .where(and(...conditions));

    // No access log here: this returns counts, not any patient's record.
    return {
      range: { start: range.startDay, end: range.endDay, timeZone: range.timeZone },
      appointments: rows.length,
      distinctPatients: new Set(rows.map((r) => r.patientId)).size,
      scope: employeeId ? "your own appointments" : "the whole clinic",
      metric: "Appointments with status 'completed' whose start falls in the range.",
    };
  },
};

async function logPatientAccess(ctx: ToolContext, patientIds: string[]) {
  await Promise.all(
    patientIds.map((patientId) =>
      recordAccess({
        organizationId: ctx.principal.organizationId,
        actorUserId: ctx.principal.dbUserId,
        patientId,
        action: "assistant_read",
        route: "assistant:get_appointments_for_range",
        purpose: "Assistant answered a schedule question",
      }),
    ),
  );
}
