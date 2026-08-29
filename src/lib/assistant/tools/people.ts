import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAccess } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import { appointments, employees, patients, userRoles, users } from "@/lib/db/schema";
import { planRead } from "../policy/scope";
import type { AssistantTool, ToolContext } from "./types";

/**
 * Reading people: patients as a list, and the staff who see them.
 *
 * `resolve_patient` answers "which one did they mean"; this answers "who is
 * there". Different questions, and conflating them made the first one worse —
 * a lookup that also lists is a lookup that returns too much.
 */

const listPatientsInput = z.object({
  /** Free text over name, nickname, number, email or phone. */
  search: z.string().trim().max(120).optional(),
  status: z.enum(["prospect", "active", "inactive", "archived"]).optional(),
  /** Only patients assigned to the caller. */
  mineOnly: z.boolean().default(false),
  limit: z.int().min(1).max(50).default(20),
});

export const listPatientsTool: AssistantTool<z.infer<typeof listPatientsInput>, unknown> = {
  name: "list_patients",
  description:
    "List patients, optionally filtered by a search term or status. Use this for 'how many " +
    "patients do we have', 'show me the inactive ones', 'who are my patients'. " +
    "For finding one specific person by name, use resolve_patient instead.",
  resource: "patients_demographic",
  action: "read",
  input: listPatientsInput,

  async execute(args, ctx: ToolContext) {
    const plan = planRead(ctx.principal, "patients_demographic");
    if (plan.mode === "denied") return { refused: true, reason: plan.reason };

    const db = getDb();
    const conditions = [
      eq(patients.organizationId, ctx.principal.organizationId),
      isNull(patients.deletedAt),
    ];
    if (plan.mode === "own" && plan.employeeId) {
      conditions.push(eq(patients.primaryPractitionerId, plan.employeeId));
    } else if (args.mineOnly && ctx.principal.employeeId) {
      conditions.push(eq(patients.primaryPractitionerId, ctx.principal.employeeId));
    }
    if (args.status) {
      conditions.push(sql`${patients.status} = ${args.status}::patient_status`);
    }
    if (args.search) {
      const q = `%${args.search}%`;
      conditions.push(
        or(
          sql`${patients.legalFirstName} ilike ${q}`,
          sql`${patients.legalLastName} ilike ${q}`,
          sql`coalesce(${patients.preferredName}, '') ilike ${q}`,
          sql`coalesce(${patients.email}, '') ilike ${q}`,
          sql`coalesce(${patients.phoneE164}, '') ilike ${q}`,
          sql`${patients.patientNumber} ilike ${q}`,
        )!,
      );
    }

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(patients)
      .where(and(...conditions));

    const rows = await db
      .select({
        id: patients.id,
        first: patients.legalFirstName,
        last: patients.legalLastName,
        preferred: patients.preferredName,
        number: patients.patientNumber,
        status: patients.status,
        email: patients.email,
        phone: patients.phoneE164,
      })
      .from(patients)
      .where(and(...conditions))
      .orderBy(asc(patients.legalLastName), asc(patients.legalFirstName))
      .limit(args.limit);

    // A role that may not see identities gets the count and nothing else.
    if (!plan.identifiable) {
      return { total, note: "This role sees counts only, without patient identities." };
    }

    await logPatients(ctx, rows.map((r) => r.id), "assistant:list_patients");

    return {
      total,
      returned: rows.length,
      truncated: total > rows.length,
      patients: rows.map((r) => ({
        patientId: r.id,
        name: `${r.first} ${r.last}`.trim(),
        goesBy: r.preferred ?? undefined,
        patientNumber: r.number,
        status: r.status,
        // Contact details are what someone needs to act, so they come along;
        // they are also the most sensitive part of a demographic record.
        email: r.email ?? undefined,
        phone: r.phone ?? undefined,
      })),
    };
  },
};

const staffInput = z.object({
  /** Only those who see patients. */
  practitionersOnly: z.boolean().default(false),
  includeArchived: z.boolean().default(false),
});

export const listStaffTool: AssistantTool<z.infer<typeof staffInput>, unknown> = {
  name: "list_staff",
  description:
    "List the clinic's employees: name, title, roles, and whether they see patients or " +
    "work home-care shifts. Use it for 'who works here', 'which practitioners are there', " +
    "'who can I book with'.",
  resource: "users_roles",
  action: "read",
  input: staffInput,

  async execute(args, ctx: ToolContext) {
    const plan = planRead(ctx.principal, "users_roles");
    if (plan.mode === "denied") {
      // Practitioners cannot read the staff directory, but knowing who else
      // sees patients is unavoidable for booking, so the names of
      // practitioners come from the schedule instead — not from here.
      return {
        refused: true,
        reason: "This role cannot read the staff directory.",
      };
    }

    const db = getDb();
    const conditions = [eq(employees.organizationId, ctx.principal.organizationId)];
    if (args.practitionersOnly) conditions.push(eq(employees.isPractitioner, true));
    if (!args.includeArchived) conditions.push(eq(users.isActive, true));

    const rows = await db
      .select({
        id: employees.id,
        first: employees.firstName,
        last: employees.lastName,
        title: employees.title,
        isPractitioner: employees.isPractitioner,
        isCaregiver: employees.isCaregiver,
        active: users.isActive,
        email: users.email,
        userId: users.id,
        role: userRoles.role,
      })
      .from(employees)
      .innerJoin(users, eq(users.id, employees.userId))
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .where(and(...conditions))
      .orderBy(asc(employees.lastName));

    // One row per role; fold them back into one entry per person.
    const byId = new Map<string, Record<string, unknown> & { roles: string[] }>();
    for (const r of rows) {
      const existing = byId.get(r.id);
      if (existing) {
        if (r.role && !existing.roles.includes(r.role)) existing.roles.push(r.role);
        continue;
      }
      byId.set(r.id, {
        employeeId: r.id,
        name: `${r.first} ${r.last}`.trim(),
        title: r.title ?? undefined,
        email: r.email,
        seesPatients: r.isPractitioner,
        doesHomeCare: r.isCaregiver,
        active: r.active,
        roles: r.role ? [r.role] : [],
      });
    }

    return { count: byId.size, staff: [...byId.values()] };
  },
};

const historyInput = z.object({
  patientId: z.uuid(),
  limit: z.int().min(1).max(50).default(20),
});

export const getPatientHistoryTool: AssistantTool<z.infer<typeof historyInput>, unknown> = {
  name: "get_patient_appointment_history",
  description:
    "Every appointment for one patient, newest first: when, with whom, what service and " +
    "how it ended. Use it for 'how many times has she come', 'when did he last cancel', " +
    "'what has this patient had done'.",
  resource: "patients_demographic",
  action: "read",
  input: historyInput,

  async execute(args, ctx: ToolContext) {
    const plan = planRead(ctx.principal, "patients_demographic");
    if (plan.mode === "denied" || !plan.identifiable) {
      return { refused: true, reason: plan.reason ?? "This role cannot read patient history." };
    }

    const db = getDb();
    const conditions = [
      eq(appointments.organizationId, ctx.principal.organizationId),
      eq(appointments.patientId, args.patientId),
    ];
    if (plan.mode === "own" && plan.employeeId) {
      conditions.push(eq(appointments.employeeId, plan.employeeId));
    }

    const rows = await db
      .select({
        id: appointments.id,
        startAt: appointments.startAt,
        status: appointments.status,
        modality: appointments.modality,
        reason: appointments.cancellationReason,
        rescheduledFrom: appointments.rescheduledFromId,
        practitionerFirst: employees.firstName,
        practitionerLast: employees.lastName,
      })
      .from(appointments)
      .innerJoin(employees, eq(employees.id, appointments.employeeId))
      .where(and(...conditions))
      .orderBy(desc(appointments.startAt))
      .limit(args.limit);

    if (!rows.length) {
      return { count: 0, appointments: [], note: "No appointments available to you for that patient." };
    }

    await logPatients(ctx, [args.patientId], "assistant:get_patient_appointment_history");

    return {
      count: rows.length,
      appointments: rows.map((r) => ({
        appointmentId: r.id,
        startAt: r.startAt.toISOString(),
        status: r.status,
        modality: r.modality,
        practitioner: `${r.practitionerFirst} ${r.practitionerLast}`.trim(),
        cancellationReason: r.reason ?? undefined,
        // Present when this appointment replaced an earlier one.
        replaced: r.rescheduledFrom ?? undefined,
      })),
    };
  },
};

async function logPatients(ctx: ToolContext, ids: string[], route: string) {
  await Promise.all(
    [...new Set(ids)].map((patientId) =>
      recordAccess({
        organizationId: ctx.principal.organizationId,
        actorUserId: ctx.principal.dbUserId,
        patientId,
        action: "assistant_read",
        route,
        purpose: "Assistant read patient information",
      }),
    ),
  );
}
