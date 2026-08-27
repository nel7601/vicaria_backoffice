"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import { patientChartNotes } from "@/lib/db/schema";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import { addChartNoteSchema } from "@/lib/schemas/clinical";
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
