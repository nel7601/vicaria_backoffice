"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { authorize, requirePrincipal } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import { appointments, appointmentStatusHistory } from "@/lib/db/schema";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import { employeeAppointmentsInWindow } from "@/lib/db/queries/appointments";
import {
  changeStatusSchema,
  createAppointmentSchema,
  updateAppointmentSchema,
} from "@/lib/schemas/appointment";
import {
  findConflicts,
  isValidTimeRange,
  type AppointmentStatus,
} from "@/lib/domain/appointment";
import { changeAppointmentStatus } from "@/lib/domain/appointments/commands";

export interface AppointmentResult {
  ok: boolean;
  appointmentId?: string;
  error?: string;
  conflicts?: number;
}

/** FR-APT-002/003: create an appointment, blocking practitioner conflicts. */
export async function createAppointmentAction(
  raw: unknown,
): Promise<AppointmentResult> {
  const user = await authorize("patients_demographic", "create");
  const parsed = createAppointmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  if (!isValidTimeRange(data.startAt, data.endAt)) {
    return { ok: false, error: "End must be after start." };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const start = new Date(data.startAt);
  const end = new Date(data.endAt);

  // Conflict detection against the practitioner's existing appointments.
  const existing = await employeeAppointmentsInWindow(
    org.id,
    data.employeeId,
    start,
    end,
  );
  const conflicts = findConflicts(
    { startAt: start, endAt: end },
    existing.map((e) => ({
      id: e.id,
      startAt: e.startAt,
      endAt: e.endAt,
      status: e.status as AppointmentStatus,
    })),
  );
  if (conflicts.length > 0) {
    return {
      ok: false,
      error: "Practitioner has a conflicting appointment in this window.",
      conflicts: conflicts.length,
    };
  }

  const db = getDb();
  const created = await db.transaction(async (tx) => {
    const [appt] = await tx
      .insert(appointments)
      .values({
        organizationId: org.id,
        patientId: data.patientId,
        serviceId: data.serviceId ?? null,
        employeeId: data.employeeId,
        locationId: data.locationId ?? null,
        startAt: start,
        endAt: end,
        modality: data.modality,
        estimatedPriceCents: data.estimatedPriceCents,
        notesAdmin: data.notesAdmin ?? null,
        status: "scheduled",
      })
      .returning();
    await tx.insert(appointmentStatusHistory).values({
      organizationId: org.id,
      appointmentId: appt.id,
      fromStatus: null,
      toStatus: "scheduled",
      changedBy: user.dbUserId,
    });
    return appt;
  });

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "create",
    entityType: "appointment",
    entityId: created.id,
    after: { start: data.startAt, end: data.endAt, status: "scheduled" },
  });

  revalidatePath("/calendar");
  return { ok: true, appointmentId: created.id };
}

/** FR-APT-004: change status via the allowed state machine, with history. */
export async function changeAppointmentStatusAction(
  appointmentId: string,
  raw: unknown,
): Promise<AppointmentResult> {
  const parsed = changeStatusSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const ctx = await webCommandContext();
  if (!ctx) return { ok: false, error: "Organization not found." };

  // The decision, the history row and the audit entry all live in the shared
  // command, so the assistant and this page cannot drift apart on what a valid
  // transition is.
  const result = await changeAppointmentStatus(ctx, {
    appointmentId,
    status: parsed.data.status,
    reason: parsed.data.reason,
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/calendar");
  return { ok: true, appointmentId };
}

/**
 * Build a command context from the cookie session.
 *
 * Falls back to the primary organization when the signed-in user has no
 * organization linked, which is how this page behaved before commands existed.
 * Tightening that is a change to the web's own behaviour and belongs with the
 * employee-provisioning work, not here.
 */
async function webCommandContext() {
  const principal = await requirePrincipal();
  const organizationId =
    principal.organizationId ?? (await getPrimaryOrganization())?.id;
  if (!organizationId) return null;
  return { principal: { ...principal, organizationId } };
}

/**
 * Edit an upcoming appointment (practitioner, service, time, modality,
 * notes). Allowed while scheduled/confirmed/checked_in; completed or dead
 * appointments are immutable history. Re-runs conflict detection excluding
 * the appointment itself.
 */
export async function updateAppointmentAction(
  appointmentId: string,
  raw: unknown,
): Promise<AppointmentResult> {
  const user = await authorize("patients_demographic", "update");
  const parsed = updateAppointmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [current] = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.organizationId, org.id),
        eq(appointments.id, appointmentId),
      ),
    )
    .limit(1);
  if (!current) return { ok: false, error: "Appointment not found." };
  if (!["scheduled", "confirmed", "checked_in"].includes(current.status)) {
    return {
      ok: false,
      error: "Only upcoming appointments can be edited.",
    };
  }

  const data = parsed.data;
  const start = new Date(data.startAt);
  const end = new Date(data.endAt);

  const existing = await employeeAppointmentsInWindow(
    org.id,
    data.employeeId,
    start,
    end,
    appointmentId,
  );
  const conflicts = findConflicts(
    { startAt: start, endAt: end },
    existing.map((e) => ({
      id: e.id,
      startAt: e.startAt,
      endAt: e.endAt,
      status: e.status as AppointmentStatus,
    })),
  );
  if (conflicts.length > 0) {
    return {
      ok: false,
      error: "The practitioner has a conflicting appointment in this window.",
      conflicts: conflicts.length,
    };
  }

  await db
    .update(appointments)
    .set({
      employeeId: data.employeeId,
      serviceId: data.serviceId || null,
      startAt: start,
      endAt: end,
      modality: data.modality,
      notesAdmin: data.notesAdmin || null,
      updatedAt: new Date(),
    })
    .where(eq(appointments.id, appointmentId));

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "update",
    entityType: "appointment",
    entityId: appointmentId,
    before: {
      employeeId: current.employeeId,
      start: current.startAt.toISOString(),
      end: current.endAt.toISOString(),
      serviceId: current.serviceId,
    },
    after: {
      employeeId: data.employeeId,
      start: data.startAt,
      end: data.endAt,
      serviceId: data.serviceId || null,
    },
  });

  revalidatePath("/calendar");
  revalidatePath(`/calendar/${appointmentId}`);
  return { ok: true, appointmentId };
}
