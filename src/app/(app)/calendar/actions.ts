"use server";

import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/lib/auth/authorize";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import {
  changeAppointmentStatus,
  createAppointment,
  updateAppointment,
  type CommandContext,
} from "@/lib/domain/appointments/commands";
import {
  changeStatusSchema,
  createAppointmentSchema,
  updateAppointmentSchema,
} from "@/lib/schemas/appointment";

/**
 * Calendar Server Actions (spec §6.3, FR-APT-002/003/004).
 *
 * These are adapters, not logic. Parsing the form, building a principal from
 * the cookie session and revalidating the page are the web's concerns; what an
 * appointment may do lives in the shared commands, which the assistant calls
 * too. Two copies of "is this a legal transition" drift until one is wrong.
 */

export interface AppointmentResult {
  ok: boolean;
  appointmentId?: string;
  error?: string;
  conflicts?: number;
}

/**
 * Build a command context from the cookie session.
 *
 * Falls back to the primary organization when the signed-in user has no
 * organization linked, which is how these actions behaved before commands
 * existed. Tightening that belongs with employee provisioning, not here.
 */
async function webContext(): Promise<CommandContext | null> {
  const principal = await requirePrincipal();
  const organizationId =
    principal.organizationId ?? (await getPrimaryOrganization())?.id;
  if (!organizationId) return null;
  return { principal: { ...principal, organizationId } };
}

export async function createAppointmentAction(
  raw: unknown,
): Promise<AppointmentResult> {
  const parsed = createAppointmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const ctx = await webContext();
  if (!ctx) return { ok: false, error: "Organization not found." };

  const data = parsed.data;
  const result = await createAppointment(ctx, {
    patientId: data.patientId,
    employeeId: data.employeeId,
    serviceId: data.serviceId ?? null,
    locationId: data.locationId ?? null,
    startAt: new Date(data.startAt),
    endAt: new Date(data.endAt),
    modality: data.modality,
    estimatedPriceCents: data.estimatedPriceCents,
    notesAdmin: data.notesAdmin ?? null,
  });

  if (!result.ok) {
    // The form shows a conflict differently from other failures.
    return {
      ok: false,
      error: result.error,
      conflicts: result.code === "conflict" ? 1 : undefined,
    };
  }

  revalidatePath("/calendar");
  return { ok: true, appointmentId: result.appointmentId };
}

export async function changeAppointmentStatusAction(
  appointmentId: string,
  raw: unknown,
): Promise<AppointmentResult> {
  const parsed = changeStatusSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const ctx = await webContext();
  if (!ctx) return { ok: false, error: "Organization not found." };

  const result = await changeAppointmentStatus(ctx, {
    appointmentId,
    status: parsed.data.status,
    reason: parsed.data.reason,
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/calendar");
  return { ok: true, appointmentId };
}

export async function updateAppointmentAction(
  appointmentId: string,
  raw: unknown,
): Promise<AppointmentResult> {
  const parsed = updateAppointmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const ctx = await webContext();
  if (!ctx) return { ok: false, error: "Organization not found." };

  const data = parsed.data;
  const result = await updateAppointment(ctx, {
    appointmentId,
    employeeId: data.employeeId,
    // The form sends "" for "no service"; the command wants an id or null.
    serviceId: data.serviceId || null,
    startAt: new Date(data.startAt),
    endAt: new Date(data.endAt),
    modality: data.modality,
    notesAdmin: data.notesAdmin || null,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      conflicts: result.code === "conflict" ? 1 : undefined,
    };
  }

  revalidatePath("/calendar");
  revalidatePath(`/calendar/${appointmentId}`);
  return { ok: true, appointmentId };
}


/**
 * The options the booking form needs, loaded when it opens.
 *
 * These lists do not change as you page through months, but they used to be
 * fetched on every navigation — three queries per click to fill a form nobody
 * had opened yet. Moving them here makes changing month cost two queries
 * instead of five, which is most of the load on a view people click through
 * quickly.
 */
export async function appointmentFormOptionsAction(): Promise<{
  patients: { id: string; label: string }[];
  employees: { id: string; label: string }[];
  services: { id: string; label: string }[];
}> {
  await requirePrincipal();
  const { getPrimaryOrganization } = await import(
    "@/lib/db/queries/organization"
  );
  const org = await getPrimaryOrganization();
  if (!org) return { patients: [], employees: [], services: [] };

  const [{ listActiveEmployees }, { listPatients }, { listActiveServices }] =
    await Promise.all([
      import("@/lib/db/queries/appointments"),
      import("@/lib/db/queries/patients"),
      import("@/lib/db/queries/catalog"),
    ]);

  const [employees, patients, services] = await Promise.all([
    listActiveEmployees(org.id),
    listPatients({ organizationId: org.id, limit: 100 }),
    listActiveServices(org.id),
  ]);

  return {
    employees: employees.map((e) => ({
      id: e.id,
      label: `${e.firstName} ${e.lastName}`,
    })),
    patients: patients.map((p) => ({
      id: p.id,
      label: `${p.preferredName || p.legalFirstName} ${p.legalLastName} (${p.patientNumber})`,
    })),
    services: services.map((s) => ({ id: s.id, label: s.nameEn })),
  };
}
