"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { authorize } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import {
  careAgreements,
  careContacts,
  careIncidents,
  careShifts,
  invoiceItems,
  invoices,
} from "@/lib/db/schema";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import { caregiverShiftsAround } from "@/lib/db/queries/care";
import {
  approveShiftSchema,
  careAgreementSchema,
  careContactSchema,
  careIncidentSchema,
  careShiftSchema,
  careShiftStatusChangeSchema,
  updateShiftTasksSchema,
} from "@/lib/schemas/care";
import {
  canTransitionAgreement,
  canTransitionShift,
  checkOutOutcome,
  findShiftConflicts,
  formatMinutes,
  isValidShiftRange,
  shiftMinutes,
  shiftTransitionRequiresReason,
  workedMinutes,
  type CareAgreementStatus,
  type CareShiftStatus,
} from "@/lib/domain/care";
import { clinicWeekWindow, shiftDay } from "@/lib/domain/timezone";

export interface CareResult {
  ok: boolean;
  id?: string;
  error?: string;
}

function blankToNull(v: string | undefined): string | null {
  return v && v.length > 0 ? v : null;
}

/** Create a home-care agreement (weekly contracted hours + period). */
export async function createCareAgreementAction(
  raw: unknown,
): Promise<CareResult> {
  const user = await authorize("home_care", "create");
  const parsed = careAgreementSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const data = parsed.data;
  if (data.endDate && data.endDate < data.startDate) {
    return { ok: false, error: "End date must be after the start date." };
  }

  const db = getDb();
  const [created] = await db
    .insert(careAgreements)
    .values({
      organizationId: org.id,
      patientId: data.patientId,
      status: "draft",
      weeklyMinutes: Math.round(data.weeklyHours * 60),
      startDate: data.startDate,
      endDate: data.endDate || null,
      hourlyRateCents: Math.round(data.hourlyRateDollars * 100),
      currency: org.currency,
      carePlan: blankToNull(data.carePlan),
      defaultTasks: data.defaultTasks ?? [],
      address: blankToNull(data.address),
    })
    .returning();

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "create",
    entityType: "care_agreement",
    entityId: created.id,
    after: {
      weeklyMinutes: created.weeklyMinutes,
      startDate: data.startDate,
      status: "draft",
    },
  });

  revalidatePath("/care");
  return { ok: true, id: created.id };
}

/** Change agreement status along the allowed lifecycle. */
export async function changeAgreementStatusAction(
  agreementId: string,
  to: CareAgreementStatus,
): Promise<CareResult> {
  const user = await authorize("home_care", "update");
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [current] = await db
    .select({ status: careAgreements.status })
    .from(careAgreements)
    .where(
      and(
        eq(careAgreements.organizationId, org.id),
        eq(careAgreements.id, agreementId),
      ),
    )
    .limit(1);
  if (!current) return { ok: false, error: "Agreement not found." };

  const from = current.status as CareAgreementStatus;
  if (!canTransitionAgreement(from, to)) {
    return { ok: false, error: `Cannot change agreement from ${from} to ${to}.` };
  }

  await db
    .update(careAgreements)
    .set({ status: to, updatedAt: new Date() })
    .where(eq(careAgreements.id, agreementId));

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "update",
    entityType: "care_agreement",
    entityId: agreementId,
    before: { status: from },
    after: { status: to },
  });

  revalidatePath("/care");
  revalidatePath(`/care/${agreementId}`);
  return { ok: true, id: agreementId };
}

/** Add a family contact to the agreement's client. */
export async function addCareContactAction(
  agreementId: string,
  raw: unknown,
): Promise<CareResult> {
  const user = await authorize("home_care", "update");
  const parsed = careContactSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [agreement] = await db
    .select({ patientId: careAgreements.patientId })
    .from(careAgreements)
    .where(
      and(
        eq(careAgreements.organizationId, org.id),
        eq(careAgreements.id, agreementId),
      ),
    )
    .limit(1);
  if (!agreement) return { ok: false, error: "Agreement not found." };

  const data = parsed.data;
  const [created] = await db.transaction(async (tx) => {
    if (data.isPrimary) {
      // Only one primary contact per client.
      await tx
        .update(careContacts)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(
          and(
            eq(careContacts.organizationId, org.id),
            eq(careContacts.patientId, agreement.patientId),
          ),
        );
    }
    return tx
      .insert(careContacts)
      .values({
        organizationId: org.id,
        patientId: agreement.patientId,
        name: data.name,
        relationship: blankToNull(data.relationship),
        phone: blankToNull(data.phone),
        email: blankToNull(data.email),
        isPrimary: data.isPrimary,
        canApprove: data.canApprove,
        notes: blankToNull(data.notes),
      })
      .returning();
  });

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "create",
    entityType: "care_contact",
    entityId: created.id,
    after: { name: data.name, isPrimary: data.isPrimary },
  });

  revalidatePath(`/care/${agreementId}`);
  return { ok: true, id: created.id };
}

/** Schedule a shift under an agreement, blocking caregiver double-booking. */
export async function createCareShiftAction(
  agreementId: string,
  raw: unknown,
): Promise<CareResult> {
  const user = await authorize("home_care", "create");
  const parsed = careShiftSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const data = parsed.data;
  const start = new Date(data.startAt);
  const end = new Date(data.endAt);
  if (!isValidShiftRange(start, end)) {
    return { ok: false, error: "End must be after start." };
  }

  const db = getDb();
  const [agreement] = await db
    .select({
      patientId: careAgreements.patientId,
      status: careAgreements.status,
      defaultTasks: careAgreements.defaultTasks,
    })
    .from(careAgreements)
    .where(
      and(
        eq(careAgreements.organizationId, org.id),
        eq(careAgreements.id, agreementId),
      ),
    )
    .limit(1);
  if (!agreement) return { ok: false, error: "Agreement not found." };
  if (agreement.status === "ended") {
    return { ok: false, error: "This agreement has ended; reactivate it first." };
  }

  const existing = await caregiverShiftsAround(
    org.id,
    data.caregiverId,
    start,
    end,
  );
  const conflicts = findShiftConflicts(
    { startAt: start, endAt: end },
    existing.map((s) => ({ ...s, status: s.status as string })),
  );
  if (conflicts.length > 0) {
    return {
      ok: false,
      error: "The caregiver already has a shift overlapping this time.",
    };
  }

  try {
    const [created] = await db
      .insert(careShifts)
      .values({
        organizationId: org.id,
        agreementId,
        patientId: agreement.patientId,
        caregiverId: data.caregiverId,
        startAt: start,
        endAt: end,
        status: "scheduled",
        visitNotes: blankToNull(data.visitNotes),
        // Visit checklist seeded from the care plan (spec §10.1/§10.2).
        tasks: (agreement.defaultTasks ?? []).map((label) => ({
          label,
          status: "pending",
        })),
        createdBy: user.dbUserId,
      })
      .returning();

    await recordAudit({
      organizationId: org.id,
      actorUserId: user.authId,
      action: "create",
      entityType: "care_shift",
      entityId: created.id,
      after: {
        start: data.startAt,
        end: data.endAt,
        caregiverId: data.caregiverId,
      },
    });
  } catch (e) {
    const overlap =
      e instanceof Error && e.message.includes("ex_care_shift_no_overlap");
    return {
      ok: false,
      error: overlap
        ? "The caregiver already has a shift overlapping this time."
        : "Could not create the shift.",
    };
  }

  revalidatePath(`/care/${agreementId}`);
  revalidatePath("/care/schedule");
  return { ok: true };
}

/**
 * Move a shift through its lifecycle. Check-in stamps check_in_at, check-out
 * stamps check_out_at and stores the visit note. Cancels/no-shows need a
 * reason.
 */
export async function changeCareShiftStatusAction(
  shiftId: string,
  raw: unknown,
): Promise<CareResult> {
  const user = await authorize("home_care", "update");
  const parsed = careShiftStatusChangeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [shift] = await db
    .select({
      status: careShifts.status,
      agreementId: careShifts.agreementId,
      startAt: careShifts.startAt,
      endAt: careShifts.endAt,
      checkInAt: careShifts.checkInAt,
    })
    .from(careShifts)
    .where(
      and(eq(careShifts.organizationId, org.id), eq(careShifts.id, shiftId)),
    )
    .limit(1);
  if (!shift) return { ok: false, error: "Shift not found." };

  const from = shift.status as CareShiftStatus;
  let to = parsed.data.status as CareShiftStatus;
  const now = new Date();

  // Check-out (spec §10.4): a relevant difference between scheduled and
  // actual time routes the visit to needs_review instead of completed.
  let approved: number | undefined;
  if (to === "completed" && from === "in_progress") {
    const scheduled = shiftMinutes(shift);
    const actual = workedMinutes({
      startAt: shift.startAt,
      endAt: shift.endAt,
      checkInAt: shift.checkInAt,
      checkOutAt: now,
    });
    to = checkOutOutcome(scheduled, actual);
    if (to === "completed") approved = actual;
  }

  if (!canTransitionShift(from, to)) {
    return { ok: false, error: `Cannot change shift from ${from} to ${to}.` };
  }
  if (shiftTransitionRequiresReason(to) && !parsed.data.reason) {
    return { ok: false, error: `A reason is required to mark ${to}.` };
  }

  await db
    .update(careShifts)
    .set({
      status: to,
      checkInAt: to === "in_progress" ? now : undefined,
      checkOutAt:
        to === "completed" || to === "needs_review" ? now : undefined,
      approvedMinutes: approved,
      approvedBy: approved !== undefined ? user.dbUserId : undefined,
      approvedAt: approved !== undefined ? now : undefined,
      visitNotes: parsed.data.visitNotes ? parsed.data.visitNotes : undefined,
      cancellationReason:
        to === "cancelled" || to === "no_show" || to === "missed"
          ? (parsed.data.reason ?? null)
          : undefined,
      updatedAt: now,
    })
    .where(eq(careShifts.id, shiftId));

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "update",
    entityType: "care_shift",
    entityId: shiftId,
    before: { status: from },
    after: { status: to, approvedMinutes: approved },
    reason: parsed.data.reason || undefined,
  });

  revalidatePath(`/care/${shift.agreementId}`);
  revalidatePath("/care/schedule");
  return { ok: true, id: shiftId };
}

/** Save the visit task checklist (spec §10.2). */
export async function updateShiftTasksAction(
  shiftId: string,
  raw: unknown,
): Promise<CareResult> {
  const user = await authorize("home_care", "update");
  const parsed = updateShiftTasksSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [shift] = await db
    .select({ agreementId: careShifts.agreementId, status: careShifts.status })
    .from(careShifts)
    .where(and(eq(careShifts.organizationId, org.id), eq(careShifts.id, shiftId)))
    .limit(1);
  if (!shift) return { ok: false, error: "Shift not found." };

  await db
    .update(careShifts)
    .set({
      tasks: parsed.data.tasks.map((t) => ({
        label: t.label,
        status: t.status,
        comment: t.comment || undefined,
      })),
      updatedAt: new Date(),
    })
    .where(eq(careShifts.id, shiftId));

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "update",
    entityType: "care_shift_tasks",
    entityId: shiftId,
    after: { tasks: parsed.data.tasks.length },
  });

  revalidatePath(`/care/${shift.agreementId}`);
  return { ok: true, id: shiftId };
}

/** Report a safety/care incident during a visit (spec §10.2). */
export async function reportCareIncidentAction(
  shiftId: string,
  raw: unknown,
): Promise<CareResult> {
  const user = await authorize("home_care", "update");
  const parsed = careIncidentSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [shift] = await db
    .select({
      agreementId: careShifts.agreementId,
      patientId: careShifts.patientId,
      caregiverId: careShifts.caregiverId,
    })
    .from(careShifts)
    .where(and(eq(careShifts.organizationId, org.id), eq(careShifts.id, shiftId)))
    .limit(1);
  if (!shift) return { ok: false, error: "Shift not found." };

  const [created] = await db
    .insert(careIncidents)
    .values({
      organizationId: org.id,
      shiftId,
      patientId: shift.patientId,
      caregiverId: shift.caregiverId,
      severity: parsed.data.severity,
      description: parsed.data.description,
      reportedBy: user.dbUserId,
    })
    .returning();

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "create",
    entityType: "care_incident",
    entityId: created.id,
    after: { severity: parsed.data.severity, shiftId },
  });

  revalidatePath(`/care/${shift.agreementId}`);
  return { ok: true, id: created.id };
}

/** Approve a needs_review visit's hours (spec §10.4) — admin resolves it. */
export async function approveShiftHoursAction(
  shiftId: string,
  raw: unknown,
): Promise<CareResult> {
  const user = await authorize("home_care", "update");
  const parsed = approveShiftSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [shift] = await db
    .select()
    .from(careShifts)
    .where(and(eq(careShifts.organizationId, org.id), eq(careShifts.id, shiftId)))
    .limit(1);
  if (!shift) return { ok: false, error: "Shift not found." };
  if (shift.status !== "needs_review") {
    return { ok: false, error: "Only visits in needs review can be approved." };
  }

  const approved =
    parsed.data.approvedMinutes ??
    workedMinutes({
      startAt: shift.startAt,
      endAt: shift.endAt,
      checkInAt: shift.checkInAt,
      checkOutAt: shift.checkOutAt,
    });

  const now = new Date();
  await db
    .update(careShifts)
    .set({
      status: "completed",
      approvedMinutes: approved,
      approvedBy: user.dbUserId,
      approvedAt: now,
      visitNotes: parsed.data.visitNotes ? parsed.data.visitNotes : undefined,
      updatedAt: now,
    })
    .where(eq(careShifts.id, shiftId));

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "update",
    entityType: "care_shift",
    entityId: shiftId,
    before: { status: "needs_review" },
    after: { status: "completed", approvedMinutes: approved },
    reason: "Hours approved after review",
  });

  revalidatePath(`/care/${shift.agreementId}`);
  revalidatePath("/care/schedule");
  return { ok: true, id: shiftId };
}

/**
 * Generate a draft invoice for one clinic-week of approved home-care hours
 * (spec §10.4 / §11: billing without manual transcription).
 */
export async function generateCareInvoiceAction(
  agreementId: string,
  weekStartDay: string,
): Promise<CareResult> {
  const user = await authorize("invoices_payments", "create");
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [agreement] = await db
    .select()
    .from(careAgreements)
    .where(
      and(
        eq(careAgreements.organizationId, org.id),
        eq(careAgreements.id, agreementId),
      ),
    )
    .limit(1);
  if (!agreement) return { ok: false, error: "Agreement not found." };

  const { from, to, weekStart } = clinicWeekWindow(weekStartDay);
  const weekShifts = await db
    .select()
    .from(careShifts)
    .where(
      and(
        eq(careShifts.organizationId, org.id),
        eq(careShifts.agreementId, agreementId),
      ),
    );

  const billable = weekShifts.filter(
    (s) =>
      s.status === "completed" &&
      s.startAt >= from &&
      s.startAt < to &&
      (s.approvedMinutes ?? 0) > 0,
  );
  const minutes = billable.reduce((sum, s) => sum + (s.approvedMinutes ?? 0), 0);
  if (minutes === 0) {
    return {
      ok: false,
      error: "No approved completed hours in that week to invoice.",
    };
  }

  const amount = Math.round((minutes / 60) * agreement.hourlyRateCents);
  const weekEnd = shiftDay(weekStart, 6);

  const [inv] = await db.transaction(async (tx) => {
    const created = await tx
      .insert(invoices)
      .values({
        organizationId: org.id,
        patientId: agreement.patientId,
        status: "draft",
        subtotalCents: amount,
        taxCents: 0,
        totalCents: amount,
        balanceCents: amount,
        currency: agreement.currency,
      })
      .returning();
    await tx.insert(invoiceItems).values({
      organizationId: org.id,
      invoiceId: created[0].id,
      description: `Home care — ${formatMinutes(minutes)} approved (week ${weekStart} → ${weekEnd}, ${billable.length} visit${billable.length === 1 ? "" : "s"})`,
      quantity: 1,
      unitPriceCents: amount,
      taxRateBps: 0,
      lineTotalCents: amount,
    });
    return created;
  });

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "create",
    entityType: "invoice",
    entityId: inv.id,
    after: {
      source: "home_care",
      agreementId,
      week: weekStart,
      minutes,
      amountCents: amount,
    },
  });

  revalidatePath("/billing");
  return { ok: true, id: inv.id };
}
