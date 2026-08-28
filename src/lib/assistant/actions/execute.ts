import { z } from "zod";
import { recordAudit } from "@/lib/audit/record";
import type { Principal } from "@/lib/auth/principal";
import {
  auditReschedule,
  rescheduleAppointment,
} from "@/lib/domain/appointments/commands";
import { assistantFlags } from "../flags";
import {
  claimProposal,
  hashArguments,
  markProposalFailed,
  type ClaimFailure,
} from "./proposals";

/**
 * Executing a confirmed proposal (§6.2, steps 5-7).
 *
 * Order matters and is not negotiable: claim the row first, then re-validate,
 * then write. Claiming first means a duplicate confirmation loses before it
 * can do anything; re-validating after means the state checked is the state at
 * write time, not the state when the proposal was shown.
 */

export type ExecuteOutcome =
  | {
      ok: true;
      /** Re-read from the database, so it reports what actually exists. */
      result: Record<string, unknown>;
      message: string;
    }
  | { ok: false; reason: string; code: ExecuteErrorCode };

export type ExecuteErrorCode = ClaimFailure | "forbidden" | "failed" | "disabled";

/** Arguments a reschedule proposal carries, as the server resolved them. */
const rescheduleArgs = z.object({
  appointmentId: z.uuid(),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  employeeId: z.uuid().optional(),
  patientId: z.uuid(),
});

export async function executeProposal(
  principal: Principal & { organizationId: string; dbUserId: string },
  proposalId: string,
  now: Date = new Date(),
  /**
   * The hash the client was shown with the confirmation card. Optional, but
   * when supplied it is what makes the confirmation provably about the action
   * the user actually read, rather than whatever that id now points at.
   */
  expectedHash?: string,
): Promise<ExecuteOutcome> {
  const flags = assistantFlags();
  if (!flags.writeActionsEnabled) {
    return {
      ok: false,
      code: "disabled",
      reason: "Write actions are switched off for this deployment.",
    };
  }

  // Claim first. A retried confirmation must lose here, before any write.
  const claim = await claimProposal(principal, proposalId, now);
  if (!claim.ok) {
    return { ok: false, code: claim.reason, reason: describeFailure(claim.reason) };
  }

  const { proposal } = claim;

  // A confirmation only means something if it is about what the user read.
  if (expectedHash && hashArguments(proposal.arguments) !== expectedHash) {
    await markProposalFailed(proposal.proposalId, "argument hash mismatch");
    return {
      ok: false,
      code: "failed",
      reason: "This action changed since it was shown to you. Ask again.",
    };
  }

  if (proposal.toolName !== "reschedule_appointment") {
    await markProposalFailed(proposal.proposalId, "unknown tool");
    return {
      ok: false,
      code: "failed",
      reason: "That action is no longer supported.",
    };
  }

  if (!flags.rescheduleEnabled) {
    await markProposalFailed(proposal.proposalId, "reschedule disabled");
    return {
      ok: false,
      code: "disabled",
      reason: "Rescheduling is switched off for this deployment.",
    };
  }

  const parsed = rescheduleArgs.safeParse(proposal.arguments);
  if (!parsed.success) {
    await markProposalFailed(proposal.proposalId, "arguments failed validation");
    return {
      ok: false,
      code: "failed",
      reason: "The stored action was not valid and was not carried out.",
    };
  }

  const outcome = await rescheduleAppointment(
    { principal, now },
    {
      appointmentId: parsed.data.appointmentId,
      startAt: new Date(parsed.data.startAt),
      endAt: new Date(parsed.data.endAt),
      employeeId: parsed.data.employeeId,
      reason: "Rescheduled via the assistant",
    },
  );

  if (!outcome.ok) {
    // The proposal is spent either way; recording why keeps the audit honest
    // and stops a failed action looking like one that never happened.
    await markProposalFailed(proposal.proposalId, outcome.error);
    await recordAudit({
      organizationId: principal.organizationId,
      actorUserId: principal.dbUserId,
      action: "assistant_action_failed",
      entityType: "assistant_action_proposal",
      entityId: proposal.proposalId,
      after: { tool: proposal.toolName, code: outcome.code },
      reason: outcome.error,
    });
    return { ok: false, code: "failed", reason: outcome.error };
  }

  await auditReschedule({ principal, now }, outcome, {
    source: "assistant",
    proposalId: proposal.proposalId,
  });

  return {
    ok: true,
    result: {
      appointmentId: outcome.appointmentId,
      replacedAppointmentId: outcome.originalId,
      startAt: outcome.startAt.toISOString(),
      endAt: outcome.endAt.toISOString(),
      patientId: outcome.patientId,
      employeeId: outcome.employeeId,
    },
    message: "Done. The appointment has been moved.",
  };
}

function describeFailure(reason: ClaimFailure): string {
  switch (reason) {
    case "already_used":
      return "That confirmation was already carried out.";
    case "expired":
      return "That proposal expired. Ask again to get a fresh one.";
    case "cancelled":
      return "That proposal was cancelled.";
    case "not_found":
      return "There is no pending action with that id.";
  }
}
