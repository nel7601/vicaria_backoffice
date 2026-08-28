import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { recordAccess } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import { appointments, invoices, patients } from "@/lib/db/schema";
import { principalReadScope } from "@/lib/auth/authorize-principal";
import { planRead } from "../policy/scope";
import type { AssistantTool, ToolContext } from "./types";

/**
 * `get_patient_summary` — what a staff member needs to know before a visit.
 *
 * Derived from the same shape as getPatient360, but cut down hard. The web
 * page can afford to show everything because a person chose to open it; a
 * voice answer should not read out a clinical history because someone asked
 * when the last visit was.
 *
 * Sections appear only if the caller's role grants them: billing figures need
 * invoice permission, and a role without it simply does not see that part
 * rather than seeing it blanked out.
 */

const inputSchema = z.object({
  /** Always an id from resolve_patient — never a name typed straight in. */
  patientId: z.uuid(),
});

type Input = z.infer<typeof inputSchema>;

export const getPatientSummaryTool: AssistantTool<Input, unknown> = {
  name: "get_patient_summary",
  description:
    "Summarise one patient: how to address them, their last and next appointment, and their " +
    "outstanding balance if you may see billing. Call resolve_patient first to get the id. " +
    "Does not return clinical notes.",
  resource: "patients_demographic",
  action: "read",
  input: inputSchema,

  async execute(args, ctx: ToolContext) {
    const plan = planRead(ctx.principal, "patients_demographic");
    if (plan.mode === "denied" || !plan.identifiable) {
      return {
        refused: true,
        reason: plan.reason ?? "This role cannot look at an individual patient.",
      };
    }

    const db = getDb();
    const conditions = [
      eq(patients.id, args.patientId),
      eq(patients.organizationId, ctx.principal.organizationId),
      isNull(patients.deletedAt),
    ];
    if (plan.mode === "own") {
      conditions.push(eq(patients.primaryPractitionerId, plan.employeeId!));
    }

    const [patient] = await db
      .select({
        id: patients.id,
        legalFirstName: patients.legalFirstName,
        legalLastName: patients.legalLastName,
        preferredName: patients.preferredName,
        pronouns: patients.pronouns,
        patientNumber: patients.patientNumber,
        status: patients.status,
        preferredLanguage: patients.preferredLanguage,
      })
      .from(patients)
      .where(and(...conditions))
      .limit(1);

    // Out of scope and non-existent answer the same way: a practitioner must
    // not learn that a patient exists by being told they may not see them.
    if (!patient) {
      return { found: false, reason: "No such patient is available to you." };
    }

    await recordAccess({
      organizationId: ctx.principal.organizationId,
      actorUserId: ctx.principal.dbUserId,
      patientId: patient.id,
      action: "assistant_read",
      route: "assistant:get_patient_summary",
      purpose: "Assistant summarised a patient record",
    });

    const history = await db
      .select({
        startAt: appointments.startAt,
        status: appointments.status,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.organizationId, ctx.principal.organizationId),
          eq(appointments.patientId, patient.id),
        ),
      )
      .orderBy(desc(appointments.startAt))
      .limit(30);

    const past = history.filter(
      (a) => a.startAt < ctx.now && a.status === "completed",
    );
    const future = history
      .filter((a) => a.startAt >= ctx.now && a.status !== "cancelled")
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

    const summary: Record<string, unknown> = {
      found: true,
      patientId: patient.id,
      name: `${patient.legalFirstName} ${patient.legalLastName}`.trim(),
      goesBy: patient.preferredName ?? undefined,
      pronouns: patient.pronouns ?? undefined,
      patientNumber: patient.patientNumber,
      status: patient.status,
      preferredLanguage: patient.preferredLanguage,
      lastCompletedVisit: past[0]?.startAt.toISOString() ?? null,
      nextAppointment: future[0]?.startAt.toISOString() ?? null,
      completedVisitsOnRecord: past.length,
    };

    // Money is a separate permission, and a separate section.
    if (principalReadScope(ctx.principal, "invoices_payments") !== "none") {
      const open = await db
        .select({
          balanceCents: invoices.balanceCents,
          status: invoices.status,
          currency: invoices.currency,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.organizationId, ctx.principal.organizationId),
            eq(invoices.patientId, patient.id),
          ),
        );

      const outstanding = open
        .filter((i) => i.status !== "void" && i.balanceCents > 0)
        .reduce((sum, i) => sum + i.balanceCents, 0);

      summary.billing = {
        outstandingCents: outstanding,
        currency: open[0]?.currency ?? "CAD",
        openInvoices: open.filter((i) => i.balanceCents > 0).length,
      };
    }

    return summary;
  },
};
