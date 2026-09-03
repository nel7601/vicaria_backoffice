"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import { patients } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import {
  findDuplicateCandidates,
  nextPatientSequence,
} from "@/lib/db/queries/patients";
import {
  createPatientSchema,
  duplicateCheckSchema,
  updatePatientSchema,
} from "@/lib/schemas/patient";
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

export interface UpdatePatientResult {
  ok: boolean;
  error?: string;
}

/**
 * FR-PAT-001: correct a patient's demographic and contact details.
 *
 * The whole before/after pair is audited, not just the changed keys: when a
 * letter goes to the wrong address, the question is what the address was on
 * the day it was sent, and only the trail can answer that.
 */
export async function updatePatientAction(
  patientId: string,
  raw: unknown,
): Promise<UpdatePatientResult> {
  const user = await authorize("patients_demographic", "update");
  const parsed = updatePatientSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [existing] = await db
    .select()
    .from(patients)
    .where(and(eq(patients.organizationId, org.id), eq(patients.id, patientId)))
    .limit(1);
  if (!existing) return { ok: false, error: "Patient not found." };

  const data = parsed.data;
  const next = {
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
    marketingOptIn: data.marketingOptIn,
    emergencyContactName: data.emergencyContactName || null,
    emergencyContactPhone: normalizePhone(data.emergencyContactPhone),
    acquisitionSource: data.acquisitionSource || null,
  };

  await db
    .update(patients)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(patients.id, patientId));

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "update",
    entityType: "patient",
    entityId: patientId,
    before: {
      legalFirstName: existing.legalFirstName,
      legalLastName: existing.legalLastName,
      preferredName: existing.preferredName,
      pronouns: existing.pronouns,
      dateOfBirth: existing.dateOfBirth,
      email: existing.email,
      phoneE164: existing.phoneE164,
      address: existing.address,
      preferredLanguage: existing.preferredLanguage,
      status: existing.status,
      marketingOptIn: existing.marketingOptIn,
      emergencyContactName: existing.emergencyContactName,
      emergencyContactPhone: existing.emergencyContactPhone,
      acquisitionSource: existing.acquisitionSource,
    },
    after: next,
  });

  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/patients");
  return { ok: true };
}
