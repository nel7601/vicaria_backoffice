"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { authorize } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import { followUpTasks, treatmentPlans } from "@/lib/db/schema";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import { createPlanSchema, createTaskSchema } from "@/lib/schemas/clinical";

export interface SimpleResult {
  ok: boolean;
  error?: string;
}

/** FR-PLAN-001: create a treatment plan. */
export async function createPlanAction(raw: unknown): Promise<SimpleResult> {
  const user = await authorize("clinical_notes", "create");
  const parsed = createPlanSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [created] = await db
    .insert(treatmentPlans)
    .values({
      organizationId: org.id,
      patientId: parsed.data.patientId,
      title: parsed.data.title,
      objective: parsed.data.objective ?? null,
      status: "active",
    })
    .returning();

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "create",
    entityType: "treatment_plan",
    entityId: created.id,
  });

  revalidatePath(`/patients/${parsed.data.patientId}`);
  return { ok: true };
}

/** FR-FU-001: create a follow-up task. */
export async function createTaskAction(raw: unknown): Promise<SimpleResult> {
  const user = await authorize("patients_demographic", "update");
  const parsed = createTaskSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  await db.insert(followUpTasks).values({
    organizationId: org.id,
    patientId: parsed.data.patientId,
    title: parsed.data.title,
    dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
    priority: parsed.data.priority,
    status: "open",
  });

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "create",
    entityType: "follow_up_task",
    entityId: parsed.data.patientId,
  });

  revalidatePath(`/patients/${parsed.data.patientId}`);
  return { ok: true };
}

/** Mark a follow-up task complete. */
export async function completeTaskAction(
  taskId: string,
  patientId: string,
): Promise<SimpleResult> {
  const user = await authorize("patients_demographic", "update");
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  await db
    .update(followUpTasks)
    .set({ status: "completed", updatedAt: new Date() })
    .where(
      and(
        eq(followUpTasks.organizationId, org.id),
        eq(followUpTasks.id, taskId),
      ),
    );

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "update",
    entityType: "follow_up_task",
    entityId: taskId,
    after: { status: "completed" },
  });

  revalidatePath(`/patients/${patientId}`);
  return { ok: true };
}
