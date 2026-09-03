"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { authorizeAny } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import {
  encounterTemplateVersions,
  encounterTemplates,
  patientForms,
} from "@/lib/db/schema";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import { addPatientFormSchema } from "@/lib/schemas/clinical";
import { validateAnswers, type TemplateField } from "@/lib/domain/encounter";
import { zonedMidnightUtc } from "@/lib/domain/timezone";

export interface FileFormResult {
  ok: boolean;
  error?: string;
}

function extractFields(schema: unknown): TemplateField[] {
  if (Array.isArray(schema)) return schema as TemplateField[];
  if (schema && typeof schema === "object" && "fields" in schema) {
    const f = (schema as { fields?: unknown }).fields;
    if (Array.isArray(f)) return f as TemplateField[];
  }
  return [];
}

/**
 * File an administrative form against a patient — a signed release, an
 * authorization: documents kept on file that are not clinical history.
 *
 * It refuses clinical templates outright. The two form kinds are stored in the
 * same table, and the only thing keeping a consent out of the chart (and a
 * clinical questionnaire out of the file) is which door it came through.
 */
export async function addPatientFileFormAction(
  raw: unknown,
): Promise<FileFormResult> {
  const user = await authorizeAny([
    ["patients_demographic", "update"],
    ["clinical_notes", "create"],
  ]);
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
      scope: encounterTemplates.scope,
    })
    .from(encounterTemplateVersions)
    .innerJoin(
      encounterTemplates,
      eq(encounterTemplates.id, encounterTemplateVersions.templateId),
    )
    .where(
      and(
        eq(encounterTemplateVersions.organizationId, org.id),
        eq(encounterTemplateVersions.id, parsed.data.templateVersionId),
      ),
    )
    .limit(1);
  if (!version) return { ok: false, error: "Form not found." };
  if (version.scope !== "administrative") {
    return {
      ok: false,
      error: "That is a clinical form — fill it from the clinical record.",
    };
  }

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
    entityType: "patient_file_form",
    entityId: created.id,
    after: {
      patientId: parsed.data.patientId,
      templateVersionId: version.id,
      filledAt: parsed.data.filledAt,
    },
  });

  revalidatePath(`/patients/${parsed.data.patientId}`);
  return { ok: true };
}
