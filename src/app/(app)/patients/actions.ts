"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import { patients } from "@/lib/db/schema";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import {
  findDuplicateCandidates,
  nextPatientSequence,
} from "@/lib/db/queries/patients";
import { createPatientSchema, duplicateCheckSchema } from "@/lib/schemas/patient";
import {
  findDuplicates,
  formatPatientNumber,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  type DuplicateMatch,
} from "@/lib/domain/patient";

export interface DuplicateCheckResult {
  matches: (DuplicateMatch & { name: string; patientId: string })[];
}

/** FR-PAT-002: run a duplicate check before creating a patient. */
export async function duplicateCheckAction(
  raw: unknown,
): Promise<DuplicateCheckResult> {
  await authorize("patients_demographic", "read");
  const parsed = duplicateCheckSchema.safeParse(raw);
  if (!parsed.success) return { matches: [] };

  const org = await getPrimaryOrganization();
  if (!org) return { matches: [] };

  const email = normalizeEmail(parsed.data.email);
  const phone = normalizePhone(parsed.data.phoneE164);
  const candidates = await findDuplicateCandidates(org.id, {
    email,
    phoneE164: phone,
    legalLastName: normalizeName(parsed.data.legalLastName),
  });

  const matches = findDuplicates(
    {
      email,
      phoneE164: phone,
      legalFirstName: parsed.data.legalFirstName,
      legalLastName: parsed.data.legalLastName,
      dateOfBirth: parsed.data.dateOfBirth,
    },
    candidates,
  );

  const byId = new Map(candidates.map((c) => [c.id, c]));
  return {
    matches: matches.map((m) => {
      const c = byId.get(m.id);
      return {
        ...m,
        patientId: m.id,
        name: `${c?.legalFirstName ?? ""} ${c?.legalLastName ?? ""}`.trim(),
      };
    }),
  };
}

export interface CreatePatientResult {
  ok: boolean;
  patientId?: string;
  error?: string;
}

/** FR-PAT-001: create a patient with normalized contact data. */
export async function createPatientAction(
  raw: unknown,
): Promise<CreatePatientResult> {
  const user = await authorize("patients_demographic", "create");
  const parsed = createPatientSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const data = parsed.data;
  const db = getDb();
  const seq = await nextPatientSequence(org.id);

  const [created] = await db
    .insert(patients)
    .values({
      organizationId: org.id,
      patientNumber: formatPatientNumber(seq),
      legalFirstName: normalizeName(data.legalFirstName)!,
      legalLastName: normalizeName(data.legalLastName)!,
      preferredName: normalizeName(data.preferredName),
      pronouns: data.pronouns || null,
      dateOfBirth: data.dateOfBirth || null,
      email: normalizeEmail(data.email),
      phoneE164: normalizePhone(data.phoneE164),
      address: data.address || null,
      preferredLanguage: data.preferredLanguage,
      status: data.status,
      emergencyContactName: data.emergencyContactName || null,
      emergencyContactPhone: normalizePhone(data.emergencyContactPhone),
      acquisitionSource: data.acquisitionSource || null,
    })
    .returning();

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "create",
    entityType: "patient",
    entityId: created.id,
    after: { patientNumber: created.patientNumber, status: created.status },
  });

  revalidatePath("/patients");
  return { ok: true, patientId: created.id };
}
