import { and, eq, gte, lt, ne } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { authorizePrincipal } from "@/lib/auth/authorize-principal";
import type { Principal } from "@/lib/auth/principal";
import { getDb } from "@/lib/db";
import { appointments, appointmentStatusHistory } from "@/lib/db/schema";
import {
  canTransition,
  findConflicts,
  transitionRequiresReason,
  type AppointmentStatus,
} from "@/lib/domain/appointment";

/**
 * Appointment write commands, shared by the web and the assistant.
 *
 * The logic used to live inside Server Actions bound to cookies, which meant
 * the assistant could only reimplement it — and two implementations of "may
 * this appointment move" drift until one of them is wrong. These take an
 * explicit principal instead, so both callers run the same validation, the
 * same authorization, the same history rows and the same audit trail.
 *
 * Every command returns a result rather than throwing for expected outcomes
 * (a conflict, a forbidden transition), because both callers have to show
 * those to a person.
 */

export interface CommandContext {
  principal: Principal & { organizationId: string };
  /** Explicit so a proposal and its execution can share one clock. */
  now?: Date;
}

export type CommandResult<T = { appointmentId: string }> =
  | ({ ok: true } & T)
  | { ok: false; error: string; code: CommandErrorCode };

export type CommandErrorCode =
  | "not_found"
  | "forbidden"
  | "conflict"
  | "invalid_state"
  | "invalid_input";

function fail(code: CommandErrorCode, error: string): CommandResult<never> {
  return { ok: false, code, error };
}

/** Statuses from which an appointment can still be moved. */
const RESCHEDULABLE: readonly string[] = ["scheduled", "confirmed", "checked_in"];

export interface RescheduleInput {
  appointmentId: string;
  startAt: Date;
  endAt: Date;
  /** Optional move to a different practitioner. */
  employeeId?: string;
  reason?: string;
}

export interface RescheduleOutcome {
  originalId: string;
  appointmentId: string;
  startAt: Date;
  endAt: Date;
  employeeId: string;
  patientId: string;
}

/**
 * Reschedule: close the original and create its successor (§6.3 of the plan).
 *
 * The existing web edit mutates the row in place, which loses the fact that
 * the appointment moved — while the schema declares `rescheduled_from_id`
 * precisely to record it. Doing it properly matters beyond tidiness: it is
 * what makes the move reversible and auditable after the fact.
 *
 * The conflict check is repeated inside the transaction, immediately before
 * writing. A slot that was free when the proposal was shown may be taken by
 * the time the user confirms, and that gap is exactly where a double booking
 * gets created. If two writers still race, `ex_appointment_no_overlap` in the
 * database is the last line, and its violation surfaces as a conflict rather
 * than a 500.
 */
export async function rescheduleAppointment(
  ctx: CommandContext,
  input: RescheduleInput,
): Promise<CommandResult<RescheduleOutcome>> {
  try {
    authorizePrincipal(ctx.principal, "patients_demographic", "update");
  } catch {
    return fail("forbidden", "You are not allowed to change appointments.");
  }

  if (input.endAt <= input.startAt) {
    return fail("invalid_input", "The end time must be after the start time.");
  }

  const db = getDb();
  const orgId = ctx.principal.organizationId;

  try {
    return await db.transaction(async (tx) => {
      // Re-read inside the transaction: the state that mattered when the
      // proposal was made is not the state that matters now.
      const [current] = await tx
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.id, input.appointmentId),
            eq(appointments.organizationId, orgId),
          ),
        )
        .limit(1);

      if (!current) return fail("not_found", "That appointment no longer exists.");

      if (!RESCHEDULABLE.includes(current.status)) {
        return fail(
          "invalid_state",
          `This appointment is ${current.status} and can no longer be moved.`,
        );
      }

      const employeeId = input.employeeId ?? current.employeeId;

      if (
        await conflictsFor(
          tx,
          orgId,
          employeeId,
          input.startAt,
          input.endAt,
          input.appointmentId,
        )
      ) {
        return fail(
          "conflict",
          "That time is no longer free for this practitioner.",
        );
      }

      const now = ctx.now ?? new Date();

      await tx
        .update(appointments)
        .set({ status: "rescheduled", updatedAt: now })
        .where(eq(appointments.id, current.id));

      await tx.insert(appointmentStatusHistory).values({
        organizationId: orgId,
        appointmentId: current.id,
        fromStatus: current.status,
        toStatus: "rescheduled",
        reason: input.reason ?? null,
        changedBy: ctx.principal.dbUserId,
      });

      // The successor copies the booking, not its history: price, service and
      // modality carry over, while status starts fresh.
      const [created] = await tx
        .insert(appointments)
        .values({
          organizationId: orgId,
          patientId: current.patientId,
          serviceId: current.serviceId,
          employeeId,
          locationId: current.locationId,
          startAt: input.startAt,
          endAt: input.endAt,
          modality: current.modality,
          estimatedPriceCents: current.estimatedPriceCents,
          notesAdmin: current.notesAdmin,
          status: "scheduled",
          rescheduledFromId: current.id,
        })
        .returning();

      await tx.insert(appointmentStatusHistory).values({
        organizationId: orgId,
        appointmentId: created.id,
        fromStatus: null,
        toStatus: "scheduled",
        reason: input.reason ?? null,
        changedBy: ctx.principal.dbUserId,
      });

      return {
        ok: true as const,
        originalId: current.id,
        appointmentId: created.id,
        startAt: created.startAt,
        endAt: created.endAt,
        employeeId: created.employeeId,
        patientId: created.patientId,
      };
    });
  } catch (error) {
    // The exclusion constraint is the last defence against a race the
    // application-level check cannot close. Present it as a conflict.
    if (isOverlapViolation(error)) {
      return fail("conflict", "That time is no longer free for this practitioner.");
    }
    throw error;
  }
}

/** Audit a completed reschedule. Separate so it runs outside the transaction. */
export async function auditReschedule(
  ctx: CommandContext,
  outcome: RescheduleOutcome,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await recordAudit({
    organizationId: ctx.principal.organizationId,
    actorUserId: ctx.principal.dbUserId ?? undefined,
    action: "update",
    entityType: "appointment",
    entityId: outcome.originalId,
    before: { status: "active" },
    after: {
      status: "rescheduled",
      replacedBy: outcome.appointmentId,
      startAt: outcome.startAt.toISOString(),
      endAt: outcome.endAt.toISOString(),
      ...extra,
    },
    reason: "Appointment rescheduled",
  });
}

export interface CreateAppointmentInput {
  patientId: string;
  employeeId: string;
  serviceId?: string | null;
  locationId?: string | null;
  startAt: Date;
  endAt: Date;
  modality: "in_person" | "virtual" | "phone";
  estimatedPriceCents?: number;
  notesAdmin?: string | null;
}

/** Book a new appointment, refusing to double-book the practitioner. */
export async function createAppointment(
  ctx: CommandContext,
  input: CreateAppointmentInput,
): Promise<CommandResult> {
  try {
    authorizePrincipal(ctx.principal, "patients_demographic", "create");
  } catch {
    return fail("forbidden", "You are not allowed to book appointments.");
  }

  if (input.endAt <= input.startAt) {
    return fail("invalid_input", "The end time must be after the start time.");
  }

  const db = getDb();
  const orgId = ctx.principal.organizationId;

  try {
    const created = await db.transaction(async (tx) => {
      const clash = await conflictsFor(tx, orgId, input.employeeId, input.startAt, input.endAt);
      if (clash) return null;

      const [appt] = await tx
        .insert(appointments)
        .values({
          organizationId: orgId,
          patientId: input.patientId,
          serviceId: input.serviceId ?? null,
          employeeId: input.employeeId,
          locationId: input.locationId ?? null,
          startAt: input.startAt,
          endAt: input.endAt,
          modality: input.modality,
          estimatedPriceCents: input.estimatedPriceCents ?? 0,
          notesAdmin: input.notesAdmin ?? null,
          status: "scheduled",
        })
        .returning();

      await tx.insert(appointmentStatusHistory).values({
        organizationId: orgId,
        appointmentId: appt.id,
        fromStatus: null,
        toStatus: "scheduled",
        changedBy: ctx.principal.dbUserId,
      });

      return appt;
    });

    if (!created) {
      return fail("conflict", "That practitioner already has an appointment then.");
    }

    await recordAudit({
      organizationId: orgId,
      actorUserId: ctx.principal.dbUserId ?? undefined,
      action: "create",
      entityType: "appointment",
      entityId: created.id,
      after: {
        start: created.startAt.toISOString(),
        end: created.endAt.toISOString(),
        status: "scheduled",
      },
    });

    return { ok: true, appointmentId: created.id };
  } catch (error) {
    if (isOverlapViolation(error)) {
      return fail("conflict", "That practitioner already has an appointment then.");
    }
    throw error;
  }
}

export interface UpdateAppointmentInput {
  appointmentId: string;
  employeeId: string;
  serviceId?: string | null;
  startAt: Date;
  endAt: Date;
  modality: "in_person" | "virtual" | "phone";
  notesAdmin?: string | null;
}

/**
 * Edit an upcoming appointment in place.
 *
 * Distinct from rescheduling on purpose: this is correcting a booking, not
 * recording that it moved. A correction leaves no successor row, so a time
 * change made here is invisible to anything that reads `rescheduled_from_id`.
 * Whether the calendar's "change the time" should become a reschedule is a
 * product decision (§12 step 3 of the plan), not something to settle by
 * quietly changing what this does.
 */
export async function updateAppointment(
  ctx: CommandContext,
  input: UpdateAppointmentInput,
): Promise<CommandResult> {
  try {
    authorizePrincipal(ctx.principal, "patients_demographic", "update");
  } catch {
    return fail("forbidden", "You are not allowed to change appointments.");
  }

  if (input.endAt <= input.startAt) {
    return fail("invalid_input", "The end time must be after the start time.");
  }

  const db = getDb();
  const orgId = ctx.principal.organizationId;

  try {
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.id, input.appointmentId),
            eq(appointments.organizationId, orgId),
          ),
        )
        .limit(1);

      if (!current) return { kind: "not_found" as const };
      if (!RESCHEDULABLE.includes(current.status)) {
        return { kind: "immutable" as const, status: current.status };
      }

      const clash = await conflictsFor(
        tx,
        orgId,
        input.employeeId,
        input.startAt,
        input.endAt,
        input.appointmentId,
      );
      if (clash) return { kind: "conflict" as const };

      await tx
        .update(appointments)
        .set({
          employeeId: input.employeeId,
          serviceId: input.serviceId ?? null,
          startAt: input.startAt,
          endAt: input.endAt,
          modality: input.modality,
          notesAdmin: input.notesAdmin ?? null,
          updatedAt: ctx.now ?? new Date(),
        })
        .where(eq(appointments.id, input.appointmentId));

      return { kind: "ok" as const, before: current };
    });

    if (result.kind === "not_found") {
      return fail("not_found", "That appointment no longer exists.");
    }
    if (result.kind === "immutable") {
      return fail(
        "invalid_state",
        `This appointment is ${result.status} and can no longer be edited.`,
      );
    }
    if (result.kind === "conflict") {
      return fail("conflict", "That practitioner already has an appointment then.");
    }

    await recordAudit({
      organizationId: orgId,
      actorUserId: ctx.principal.dbUserId ?? undefined,
      action: "update",
      entityType: "appointment",
      entityId: input.appointmentId,
      before: {
        employeeId: result.before.employeeId,
        start: result.before.startAt.toISOString(),
        end: result.before.endAt.toISOString(),
        serviceId: result.before.serviceId,
      },
      after: {
        employeeId: input.employeeId,
        start: input.startAt.toISOString(),
        end: input.endAt.toISOString(),
        serviceId: input.serviceId ?? null,
      },
    });

    return { ok: true, appointmentId: input.appointmentId };
  } catch (error) {
    if (isOverlapViolation(error)) {
      return fail("conflict", "That practitioner already has an appointment then.");
    }
    throw error;
  }
}

/**
 * Does this slot clash with the practitioner's existing appointments?
 *
 * Always inside the caller's transaction, so the answer is still true when the
 * write happens a moment later.
 */
async function conflictsFor(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  organizationId: string,
  employeeId: string,
  startAt: Date,
  endAt: Date,
  excludeId?: string,
): Promise<boolean> {
  const conditions = [
    eq(appointments.organizationId, organizationId),
    eq(appointments.employeeId, employeeId),
    lt(appointments.startAt, endAt),
    gte(appointments.endAt, startAt),
  ];
  if (excludeId) conditions.push(ne(appointments.id, excludeId));

  const overlapping = await tx
    .select({
      id: appointments.id,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      status: appointments.status,
    })
    .from(appointments)
    .where(and(...conditions));

  return (
    findConflicts(
      { startAt, endAt },
      overlapping.map((o) => ({
        id: o.id,
        startAt: o.startAt,
        endAt: o.endAt,
        status: o.status as AppointmentStatus,
      })),
    ).length > 0
  );
}

export interface ChangeStatusInput {
  appointmentId: string;
  status: AppointmentStatus;
  reason?: string;
}

/** Move an appointment through the allowed state machine, with history. */
export async function changeAppointmentStatus(
  ctx: CommandContext,
  input: ChangeStatusInput,
): Promise<CommandResult> {
  try {
    authorizePrincipal(ctx.principal, "patients_demographic", "update");
  } catch {
    return fail("forbidden", "You are not allowed to change appointments.");
  }

  const db = getDb();
  const orgId = ctx.principal.organizationId;

  const [current] = await db
    .select({ status: appointments.status })
    .from(appointments)
    .where(
      and(
        eq(appointments.id, input.appointmentId),
        eq(appointments.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!current) return fail("not_found", "That appointment no longer exists.");

  const from = current.status as AppointmentStatus;
  if (!canTransition(from, input.status)) {
    return fail(
      "invalid_state",
      `An appointment cannot go from ${from} to ${input.status}.`,
    );
  }
  if (transitionRequiresReason(input.status) && !input.reason) {
    return fail("invalid_input", `A reason is required to mark ${input.status}.`);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(appointments)
      .set({
        status: input.status,
        cancellationReason:
          input.status === "cancelled" ? (input.reason ?? null) : undefined,
        updatedAt: ctx.now ?? new Date(),
      })
      .where(eq(appointments.id, input.appointmentId));

    await tx.insert(appointmentStatusHistory).values({
      organizationId: orgId,
      appointmentId: input.appointmentId,
      fromStatus: from,
      toStatus: input.status,
      reason: input.reason ?? null,
      changedBy: ctx.principal.dbUserId,
    });
  });

  await recordAudit({
    organizationId: orgId,
    actorUserId: ctx.principal.dbUserId ?? undefined,
    action: "update",
    entityType: "appointment",
    entityId: input.appointmentId,
    before: { status: from },
    after: { status: input.status },
    reason: input.reason,
  });

  return { ok: true, appointmentId: input.appointmentId };
}

/** Postgres raises 23P01 for an exclusion-constraint violation. */
function isOverlapViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: string; constraint_name?: string; message?: string };
  return (
    e.code === "23P01" ||
    e.constraint_name === "ex_appointment_no_overlap" ||
    (e.message?.includes("ex_appointment_no_overlap") ?? false)
  );
}
