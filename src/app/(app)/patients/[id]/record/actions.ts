"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { authorize } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import {
  encounterTemplateVersions,
  patientChartNotes,
  patientForms,
} from "@/lib/db/schema";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import {
  addChartNoteSchema,
  addPatientFormSchema,
  updatePatientFormSchema,
} from "@/lib/schemas/clinical";
import { validateAnswers, type TemplateField } from "@/lib/domain/encounter";
import { zonedMidnightUtc } from "@/lib/domain/timezone";

export interface SimpleResult {
  ok: boolean;
  error?: string;
}

/** Add a chart note to the patient's clinical record (Evolution tab). */
export async function addChartNoteAction(raw: unknown): Promise<SimpleResult> {
  const user = await authorize("clinical_notes", "create");
  const parsed = addChartNoteSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [created] = await db
    .insert(patientChartNotes)
    .values({
      organizationId: org.id,
      patientId: parsed.data.patientId,
      authorUserId: user.dbUserId,
      notedAt: zonedMidnightUtc(parsed.data.notedAt),
      body: parsed.data.body,
    })
    .returning();

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "create",
    entityType: "patient_chart_note",
    entityId: created.id,
    after: { patientId: parsed.data.patientId, notedAt: parsed.data.notedAt },
  });

  revalidatePath(`/patients/${parsed.data.patientId}/record`);
  revalidatePath(`/patients/${parsed.data.patientId}`);
  return { ok: true };
}

function extractFields(schema: unknown): TemplateField[] {
  if (Array.isArray(schema)) return schema as TemplateField[];
  if (schema && typeof schema === "object" && "fields" in schema) {
    const f = (schema as { fields?: unknown }).fields;
    if (Array.isArray(f)) return f as TemplateField[];
  }
  return [];
}

/** Fill a form from the clinical record; it becomes a tab entry. */
export async function addPatientFormAction(raw: unknown): Promise<SimpleResult> {
  const user = await authorize("clinical_notes", "create");
  const parsed = addPatientFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [version] = await db
    .select({
      id: encounterTemplateVersions.id,
      schema: encounterTemplateVersions.schema,
    })
    .from(encounterTemplateVersions)
    .where(
      and(
        eq(encounterTemplateVersions.organizationId, org.id),
        eq(encounterTemplateVersions.id, parsed.data.templateVersionId),
      ),
    )
    .limit(1);
  if (!version) return { ok: false, error: "Form not found." };

  const fields = extractFields(version.schema);
  const validation = validateAnswers({ fields }, parsed.data.answers);
  if (!validation.ok) {
    const first = Object.values(validation.errors)[0];
    return { ok: false, error: first ?? "Invalid answers." };
  }

  const [created] = await db
    .insert(patientForms)
    .values({
      organizationId: org.id,
      patientId: parsed.data.patientId,
      templateVersionId: version.id,
      answers: parsed.data.answers,
      filledAt: zonedMidnightUtc(parsed.data.filledAt),
      filledBy: user.dbUserId,
    })
    .returning();

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "create",
    entityType: "patient_form",
    entityId: created.id,
    after: {
      patientId: parsed.data.patientId,
      templateVersionId: version.id,
      filledAt: parsed.data.filledAt,
    },
  });

  revalidatePath(`/patients/${parsed.data.patientId}/record`);
  return { ok: true };
}

/**
 * Edit a filled form — e.g. complete answers that were missing when it was
 * first filled. Answers are re-validated against the pinned template version.
 */
export async function updatePatientFormAction(
  formId: string,
  raw: unknown,
): Promise<SimpleResult> {
  const user = await authorize("clinical_notes", "update");
  const parsed = updatePatientFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [existing] = await db
    .select({
      id: patientForms.id,
      patientId: patientForms.patientId,
      answers: patientForms.answers,
      filledAt: patientForms.filledAt,
      schema: encounterTemplateVersions.schema,
    })
    .from(patientForms)
    .innerJoin(
      encounterTemplateVersions,
      eq(encounterTemplateVersions.id, patientForms.templateVersionId),
    )
    .where(
      and(
        eq(patientForms.organizationId, org.id),
        eq(patientForms.id, formId),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, error: "Form not found." };

  const fields = extractFields(existing.schema);
  const validation = validateAnswers({ fields }, parsed.data.answers);
  if (!validation.ok) {
    const first = Object.values(validation.errors)[0];
    return { ok: false, error: first ?? "Invalid answers." };
  }

  await db
    .update(patientForms)
    .set({
      answers: parsed.data.answers,
      filledAt: zonedMidnightUtc(parsed.data.filledAt),
      updatedAt: new Date(),
    })
    .where(eq(patientForms.id, formId));

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "update",
    entityType: "patient_form",
    entityId: formId,
    before: { answers: existing.answers, filledAt: existing.filledAt },
    after: { answers: parsed.data.answers, filledAt: parsed.data.filledAt },
  });

  revalidatePath(`/patients/${existing.patientId}/record`);
  return { ok: true };
}
