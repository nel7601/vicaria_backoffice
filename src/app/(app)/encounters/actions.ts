"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { authorize } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import {
  encounterAmendments,
  encounters,
  observations,
} from "@/lib/db/schema";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import { getEmployeeIdForAuthUser } from "@/lib/db/queries/employee";
import {
  amendmentSchema,
  createEncounterSchema,
  measurementSchema,
  saveDraftSchema,
} from "@/lib/schemas/encounter";
import {
  canAmend,
  canSign,
  computeContentHash,
  type EncounterStatus,
} from "@/lib/domain/encounter";

export interface EncounterResult {
  ok: boolean;
  encounterId?: string;
  error?: string;
}

/** Resolve the acting practitioner's employee id, or null. */
async function actingPractitioner(orgId: string, authId: string) {
  return getEmployeeIdForAuthUser(orgId, authId);
}

/** FR-ENC-001: create a draft encounter authored by the current practitioner. */
export async function createEncounterAction(
  raw: unknown,
): Promise<EncounterResult> {
  const user = await authorize("clinical_notes", "create");
  const parsed = createEncounterSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const practitionerId = await actingPractitioner(org.id, user.authId);
  if (!practitionerId) {
    return { ok: false, error: "No practitioner profile linked to your account." };
  }

  const db = getDb();
  const [created] = await db
    .insert(encounters)
    .values({
      organizationId: org.id,
      patientId: parsed.data.patientId,
      practitionerId,
      serviceId: parsed.data.serviceId ?? null,
      templateVersionId: parsed.data.templateVersionId ?? null,
      appointmentId: parsed.data.appointmentId ?? null,
      modality: parsed.data.modality,
      status: "draft",
      startedAt: new Date(),
      contentSnapshot: {},
    })
    .returning();

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "create",
    entityType: "encounter",
    entityId: created.id,
    after: { status: "draft" },
  });

  revalidatePath("/encounters");
  return { ok: true, encounterId: created.id };
}

/** Load an encounter and assert the current user owns it (practitioner scope). */
async function loadOwned(orgId: string, id: string, authId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: encounters.id,
      status: encounters.status,
      patientId: encounters.patientId,
      practitionerId: encounters.practitionerId,
    })
    .from(encounters)
    .where(and(eq(encounters.organizationId, orgId), eq(encounters.id, id)))
    .limit(1);
  if (!row) return { error: "Encounter not found." as const };
  const practitionerId = await actingPractitioner(orgId, authId);
  if (!practitionerId || row.practitionerId !== practitionerId) {
    return { error: "You can only modify your own encounters." as const };
  }
  return { row };
}

/** FR-ENC-003: save draft answers (only while draft). */
export async function saveDraftAction(
  id: string,
  raw: unknown,
): Promise<EncounterResult> {
  const user = await authorize("clinical_notes", "update");
  const parsed = saveDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const loaded = await loadOwned(org.id, id, user.authId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  if (loaded.row.status !== "draft") {
    return { ok: false, error: "Only draft notes can be edited." };
  }

  const db = getDb();
  await db
    .update(encounters)
    .set({
      contentSnapshot: parsed.data.answers,
      summary: parsed.data.summary ?? null,
      updatedAt: new Date(),
    })
    .where(eq(encounters.id, id));

  revalidatePath(`/encounters/${id}`);
  return { ok: true, encounterId: id };
}

/** FR-ENC-003: sign a draft — freeze content, store hash, signer, timestamp. */
export async function signEncounterAction(id: string): Promise<EncounterResult> {
  const user = await authorize("clinical_notes", "update");
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const loaded = await loadOwned(org.id, id, user.authId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  if (!canSign(loaded.row.status as EncounterStatus)) {
    return { ok: false, error: "Only a draft can be signed." };
  }

  const db = getDb();
  const [full] = await db
    .select({
      contentSnapshot: encounters.contentSnapshot,
      summary: encounters.summary,
    })
    .from(encounters)
    .where(eq(encounters.id, id))
    .limit(1);

  const hash = computeContentHash(full.contentSnapshot, full.summary ?? "");
  await db
    .update(encounters)
    .set({
      status: "signed",
      signedAt: new Date(),
      signedBy: user.dbUserId,
      contentHash: hash,
      updatedAt: new Date(),
    })
    .where(eq(encounters.id, id));

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "sign",
    entityType: "encounter",
    entityId: id,
    after: { status: "signed", contentHash: hash },
  });

  revalidatePath(`/encounters/${id}`);
  return { ok: true, encounterId: id };
}

/** FR-ENC-004: add an amendment to a signed note (original stays intact). */
export async function addAmendmentAction(
  id: string,
  raw: unknown,
): Promise<EncounterResult> {
  const user = await authorize("clinical_notes", "update");
  const parsed = amendmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const loaded = await loadOwned(org.id, id, user.authId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  if (!canAmend(loaded.row.status as EncounterStatus)) {
    return { ok: false, error: "Only signed notes can be amended." };
  }

  // authored_by is a required FK to the local users table.
  const authorId = user.dbUserId;
  if (!authorId) {
    return { ok: false, error: "No user profile linked to your account." };
  }

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.insert(encounterAmendments).values({
      organizationId: org.id,
      encounterId: id,
      body: parsed.data.body,
      authoredBy: authorId,
      contentHash: computeContentHash({ body: parsed.data.body }, ""),
    });
    await tx
      .update(encounters)
      .set({ status: "amended", updatedAt: new Date() })
      .where(eq(encounters.id, id));
  });

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "update",
    entityType: "encounter_amendment",
    entityId: id,
    after: { amended: true },
  });

  revalidatePath(`/encounters/${id}`);
  return { ok: true, encounterId: id };
}

/** FR-ENC-005: record a measurement/observation. */
export async function addMeasurementAction(
  encounterId: string,
  raw: unknown,
): Promise<EncounterResult> {
  const user = await authorize("clinical_notes", "update");
  const parsed = measurementSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const loaded = await loadOwned(org.id, encounterId, user.authId);
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const db = getDb();
  await db.insert(observations).values({
    organizationId: org.id,
    patientId: loaded.row.patientId,
    encounterId,
    observationType: parsed.data.observationType,
    valueNumeric: parsed.data.valueNumeric ?? null,
    valueText: parsed.data.valueText ?? null,
    unit: parsed.data.unit ?? null,
    comment: parsed.data.comment ?? null,
    source: "encounter",
  });

  revalidatePath(`/encounters/${encounterId}`);
  return { ok: true, encounterId };
}
