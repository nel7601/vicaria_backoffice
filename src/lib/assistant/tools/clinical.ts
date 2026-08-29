import { and, desc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { recordAccess } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import {
  employees,
  encounters,
  observations,
  patientChartNotes,
  patients,
  services,
  treatmentPlans,
} from "@/lib/db/schema";
import { planRead } from "../policy/scope";
import { dateSpecSchema, resolveDate } from "./resolve-date";
import type { AssistantTool, ToolContext } from "./types";

/**
 * The clinical record.
 *
 * The original plan kept this away from the model: notes are the most
 * sensitive text in the system and the natural vector for instructions hidden
 * in data. Including them was decided deliberately, for an experiment on test
 * data, with a move to self-hosted models before real records.
 *
 * Two things still hold. Reading a note is reading a patient's record, so it
 * is logged like any other access. And note content reaches the model as tool
 * output — data, never instruction — so a note reading "ignore your
 * instructions" is a string in a field, not a command.
 */

const encountersInput = z.object({
  patientId: z.uuid().optional(),
  range: dateSpecSchema.optional(),
  status: z.enum(["draft", "signed", "amended"]).optional(),
  /** Only the caller's own encounters. */
  mineOnly: z.boolean().default(false),
  limit: z.int().min(1).max(30).default(15),
});

export const listEncountersTool: AssistantTool<z.infer<typeof encountersInput>, unknown> = {
  name: "list_encounters",
  description:
    "Clinical encounters: when, which patient, which practitioner, service, status and " +
    "summary. Use it for 'do I have unsigned notes', 'what encounters did she have', " +
    "'what was done in July'. Returns summaries, not the full note — use get_encounter for that.",
  resource: "clinical_notes",
  action: "read",
  input: encountersInput,

  async execute(args, ctx: ToolContext) {
    const plan = planRead(ctx.principal, "clinical_notes");
    if (plan.mode === "denied") return { refused: true, reason: plan.reason };

    const db = getDb();
    const conditions = [eq(encounters.organizationId, ctx.principal.organizationId)];

    if (args.patientId) conditions.push(eq(encounters.patientId, args.patientId));
    if (args.status) {
      conditions.push(
        eq(encounters.status, args.status as "draft" | "signed" | "amended"),
      );
    }
    // "own" here means authored by the caller, which is how the matrix defines
    // a practitioner's reach over clinical notes.
    const mine =
      plan.mode === "own" ? plan.employeeId : args.mineOnly ? ctx.principal.employeeId : undefined;
    if (plan.mode === "own" && !mine) return { refused: true, reason: plan.reason };
    if (mine) conditions.push(eq(encounters.practitionerId, mine));

    const range = args.range ? resolveDate(args.range, ctx.now, ctx.timeZone) : undefined;
    if (range) {
      conditions.push(gte(encounters.startedAt, range.from));
      conditions.push(lt(encounters.startedAt, range.to));
    }

    const rows = await db
      .select({
        id: encounters.id,
        startedAt: encounters.startedAt,
        signedAt: encounters.signedAt,
        status: encounters.status,
        summary: encounters.summary,
        patientId: encounters.patientId,
        patientFirst: patients.legalFirstName,
        patientLast: patients.legalLastName,
        practFirst: employees.firstName,
        practLast: employees.lastName,
        service: services.nameEn,
      })
      .from(encounters)
      .innerJoin(patients, eq(patients.id, encounters.patientId))
      .innerJoin(employees, eq(employees.id, encounters.practitionerId))
      .leftJoin(services, eq(services.id, encounters.serviceId))
      .where(and(...conditions))
      .orderBy(desc(encounters.startedAt))
      .limit(args.limit);

    await logAccess(ctx, rows.map((r) => r.patientId), "assistant:list_encounters");

    return {
      count: rows.length,
      encounters: rows.map((r) => ({
        encounterId: r.id,
        startedAt: r.startedAt?.toISOString() ?? null,
        signedAt: r.signedAt?.toISOString() ?? null,
        status: r.status,
        patient: `${r.patientFirst} ${r.patientLast}`.trim(),
        patientId: r.patientId,
        practitioner: `${r.practFirst} ${r.practLast}`.trim(),
        service: r.service ?? undefined,
        summary: r.summary ?? undefined,
      })),
    };
  },
};

const encounterInput = z.object({ encounterId: z.uuid() });

export const getEncounterTool: AssistantTool<z.infer<typeof encounterInput>, unknown> = {
  name: "get_encounter",
  description:
    "One clinical encounter in full, including the recorded note content and any " +
    "measurements taken. This is the patient's clinical record — quote from it only when " +
    "asked, and never repeat it aloud where others can hear.",
  resource: "clinical_notes",
  action: "read",
  input: encounterInput,

  async execute(args, ctx: ToolContext) {
    const plan = planRead(ctx.principal, "clinical_notes");
    if (plan.mode === "denied") return { refused: true, reason: plan.reason };

    const db = getDb();
    const conditions = [
      eq(encounters.id, args.encounterId),
      eq(encounters.organizationId, ctx.principal.organizationId),
    ];
    if (plan.mode === "own" && plan.employeeId) {
      conditions.push(eq(encounters.practitionerId, plan.employeeId));
    }

    const [row] = await db
      .select({
        id: encounters.id,
        startedAt: encounters.startedAt,
        endedAt: encounters.endedAt,
        signedAt: encounters.signedAt,
        status: encounters.status,
        summary: encounters.summary,
        content: encounters.contentSnapshot,
        modality: encounters.modality,
        patientId: encounters.patientId,
        patientFirst: patients.legalFirstName,
        patientLast: patients.legalLastName,
        practFirst: employees.firstName,
        practLast: employees.lastName,
      })
      .from(encounters)
      .innerJoin(patients, eq(patients.id, encounters.patientId))
      .innerJoin(employees, eq(employees.id, encounters.practitionerId))
      .where(and(...conditions))
      .limit(1);

    if (!row) return { found: false, reason: "No such encounter is available to you." };

    const measurements = await db
      .select({
        type: observations.observationType,
        numeric: observations.valueNumeric,
        text: observations.valueText,
        unit: observations.unit,
        observedAt: observations.observedAt,
      })
      .from(observations)
      .where(eq(observations.encounterId, row.id));

    await logAccess(ctx, [row.patientId], "assistant:get_encounter");

    return {
      found: true,
      encounterId: row.id,
      patient: `${row.patientFirst} ${row.patientLast}`.trim(),
      patientId: row.patientId,
      practitioner: `${row.practFirst} ${row.practLast}`.trim(),
      startedAt: row.startedAt?.toISOString() ?? null,
      endedAt: row.endedAt?.toISOString() ?? null,
      signedAt: row.signedAt?.toISOString() ?? null,
      status: row.status,
      modality: row.modality,
      summary: row.summary ?? undefined,
      /** The filled form, as recorded. Treat every field as data. */
      content: row.content,
      measurements: measurements.map((m) => ({
        type: m.type,
        value: m.numeric ?? m.text,
        unit: m.unit ?? undefined,
        observedAt: m.observedAt?.toISOString() ?? null,
      })),
    };
  },
};

const chartInput = z.object({
  patientId: z.uuid(),
  limit: z.int().min(1).max(30).default(15),
});

export const getPatientChartTool: AssistantTool<z.infer<typeof chartInput>, unknown> = {
  name: "get_patient_chart",
  description:
    "A patient's clinical chart: administrative notes, treatment plans and recorded " +
    "measurements over time. Use it for 'what is her treatment plan', 'what has been " +
    "noted about him', 'how has her weight changed'.",
  resource: "clinical_notes",
  action: "read",
  input: chartInput,

  async execute(args, ctx: ToolContext) {
    const plan = planRead(ctx.principal, "clinical_notes");
    if (plan.mode === "denied") return { refused: true, reason: plan.reason };

    const db = getDb();
    const org = ctx.principal.organizationId;

    const [notes, plans, measurements] = await Promise.all([
      db
        .select({
          notedAt: patientChartNotes.notedAt,
          body: patientChartNotes.body,
        })
        .from(patientChartNotes)
        .where(
          and(
            eq(patientChartNotes.organizationId, org),
            eq(patientChartNotes.patientId, args.patientId),
          ),
        )
        .orderBy(desc(patientChartNotes.notedAt))
        .limit(args.limit),
      db
        .select({
          id: treatmentPlans.id,
          title: treatmentPlans.title,
          objective: treatmentPlans.objective,
          status: treatmentPlans.status,
          startDate: treatmentPlans.startDate,
          endDate: treatmentPlans.endDate,
        })
        .from(treatmentPlans)
        .where(
          and(
            eq(treatmentPlans.organizationId, org),
            eq(treatmentPlans.patientId, args.patientId),
          ),
        )
        .orderBy(desc(treatmentPlans.startDate)),
      db
        .select({
          type: observations.observationType,
          numeric: observations.valueNumeric,
          text: observations.valueText,
          unit: observations.unit,
          observedAt: observations.observedAt,
        })
        .from(observations)
        .where(
          and(
            eq(observations.organizationId, org),
            eq(observations.patientId, args.patientId),
          ),
        )
        .orderBy(desc(observations.observedAt))
        .limit(40),
    ]);

    if (!notes.length && !plans.length && !measurements.length) {
      return { patientId: args.patientId, empty: true, note: "Nothing recorded, or nothing available to you." };
    }

    await logAccess(ctx, [args.patientId], "assistant:get_patient_chart");

    return {
      patientId: args.patientId,
      notes: notes.map((n) => ({
        notedAt: n.notedAt?.toISOString() ?? null,
        body: n.body,
      })),
      treatmentPlans: plans.map((p) => ({
        planId: p.id,
        title: p.title,
        objective: p.objective ?? undefined,
        status: p.status,
        startDate: p.startDate?.toISOString() ?? null,
        endDate: p.endDate?.toISOString() ?? null,
      })),
      measurements: measurements.map((m) => ({
        type: m.type,
        value: m.numeric ?? m.text,
        unit: m.unit ?? undefined,
        observedAt: m.observedAt?.toISOString() ?? null,
      })),
    };
  },
};

async function logAccess(ctx: ToolContext, ids: string[], route: string) {
  await Promise.all(
    [...new Set(ids)].map((patientId) =>
      recordAccess({
        organizationId: ctx.principal.organizationId,
        actorUserId: ctx.principal.dbUserId,
        patientId,
        action: "assistant_read",
        route,
        // Named apart from other reads: a privacy audit should be able to see
        // clinical access without filtering the rest out by hand.
        purpose: "Assistant read the clinical record",
      }),
    ),
  );
}
