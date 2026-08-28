import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { appointments, employees, patients } from "@/lib/db/schema";
import { principalCan } from "@/lib/auth/authorize-principal";
import { zonedInstantUtc } from "@/lib/domain/timezone";
import { createProposal, hashArguments } from "../actions/proposals";
import { assistantFlags } from "../flags";
import { planRead } from "../policy/scope";
import type { AssistantTool, ToolContext } from "./types";

/**
 * `reschedule_appointment` — proposes a move; never performs one (§6.1).
 *
 * This is the only write action in the pilot, and it still does not write. It
 * resolves the appointment and the new slot, checks everything it can check,
 * and records a proposal for a person to confirm. The write happens in
 * /actions/execute, after that confirmation.
 *
 * The separation is the safety property: no sequence of model outputs, however
 * confident, moves an appointment on its own.
 */

const inputSchema = z.object({
  /** From get_appointments_for_range — never a description of the appointment. */
  appointmentId: z.uuid(),
  /** The new day, absolute. Resolve it with resolve_date first. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date"),
  /** Clinic-local wall clock, 24-hour. Ask the user if am/pm was ambiguous. */
  hour: z.int().min(0).max(23),
  minute: z.int().min(0).max(59).default(0),
});

type Input = z.infer<typeof inputSchema>;

export const rescheduleAppointmentTool: AssistantTool<Input, unknown> = {
  name: "reschedule_appointment",
  description:
    "Propose moving an existing appointment to a new day and time. " +
    "This does NOT move it: it returns a proposal the user must confirm. " +
    "Get the appointmentId from get_appointments_for_range and the day from resolve_date. " +
    "The hour is 24-hour clinic local time — if the user said 'three' without saying am or pm, ask.",
  resource: "patients_demographic",
  action: "update",
  input: inputSchema,

  isAvailable(principal) {
    const flags = assistantFlags();
    return (
      flags.rescheduleEnabled &&
      principalCan(principal, "patients_demographic", "update")
    );
  },

  async execute(args, ctx: ToolContext) {
    const plan = planRead(ctx.principal, "patients_demographic");
    if (plan.mode === "denied" || !plan.identifiable) {
      return { refused: true, reason: "You cannot change appointments." };
    }

    const db = getDb();
    const conditions = [
      eq(appointments.id, args.appointmentId),
      eq(appointments.organizationId, ctx.principal.organizationId),
    ];
    if (plan.mode === "own") {
      conditions.push(eq(appointments.employeeId, plan.employeeId!));
    }

    const [current] = await db
      .select({
        id: appointments.id,
        startAt: appointments.startAt,
        endAt: appointments.endAt,
        status: appointments.status,
        employeeId: appointments.employeeId,
        patientId: appointments.patientId,
        patientFirst: patients.legalFirstName,
        patientLast: patients.legalLastName,
        preferredName: patients.preferredName,
        practitionerFirst: employees.firstName,
        practitionerLast: employees.lastName,
      })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .innerJoin(employees, eq(employees.id, appointments.employeeId))
      .where(and(...conditions))
      .limit(1);

    if (!current) {
      return { proposed: false, reason: "No such appointment is available to you." };
    }
    if (!["scheduled", "confirmed", "checked_in"].includes(current.status)) {
      return {
        proposed: false,
        reason: `That appointment is ${current.status} and can no longer be moved.`,
      };
    }

    // Keep the original duration: the user asked to move the appointment, not
    // to change how long it lasts.
    const durationMs = current.endAt.getTime() - current.startAt.getTime();
    const startAt = zonedInstantUtc(args.day, args.hour, args.minute, ctx.timeZone);
    const endAt = new Date(startAt.getTime() + durationMs);

    if (startAt <= ctx.now) {
      return {
        proposed: false,
        reason: "That time is in the past. Confirm the date with the user.",
      };
    }

    const proposalArguments = {
      appointmentId: current.id,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      patientId: current.patientId,
    };

    const who = current.preferredName
      ? `${current.preferredName} (${current.patientFirst} ${current.patientLast})`
      : `${current.patientFirst} ${current.patientLast}`;
    const when = new Intl.DateTimeFormat("en-CA", {
      timeZone: ctx.timeZone,
      dateStyle: "full",
      timeStyle: "short",
    }).format(startAt);
    const summary =
      `Move ${who}'s appointment with ` +
      `${current.practitionerFirst} ${current.practitionerLast} to ${when}.`;

    const proposal = await createProposal(ctx.principal, {
      toolName: "reschedule_appointment",
      arguments: proposalArguments,
      summary,
    }, ctx.now);

    return {
      proposed: true,
      proposalId: proposal.proposalId,
      /** The client echoes this back on confirmation to prove what it showed. */
      argumentsHash: hashArguments(proposalArguments),
      expiresAt: proposal.expiresAt.toISOString(),
      summary,
      details: {
        patient: who,
        patientId: current.patientId,
        practitioner: `${current.practitionerFirst} ${current.practitionerLast}`,
        movingFrom: current.startAt.toISOString(),
        movingTo: startAt.toISOString(),
        endsAt: endAt.toISOString(),
        timeZone: ctx.timeZone,
      },
      guidance:
        "Tell the user exactly what will happen, using the absolute date and time, " +
        "and wait for them to confirm. You cannot confirm on their behalf.",
    };
  },
};
