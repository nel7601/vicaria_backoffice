import { recordAudit } from "@/lib/audit/record";
import { principalCan } from "@/lib/auth/authorize-principal";
import type { Principal } from "@/lib/auth/principal";
import { CLINIC_TZ } from "@/lib/domain/timezone";
import { assistantFlags } from "../flags";
import { findAction } from "./catalog";
// Importing the definitions is what registers them.
import "./definitions";
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

/**
 * Carry out a confirmed proposal.
 *
 * Order matters and is not negotiable: claim the row first, then re-validate,
 * then write. Claiming first means a duplicate confirmation loses before it
 * can do anything; re-validating after means the state checked is the state at
 * write time, not the state when the proposal was shown.
 */
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

  const definition = findAction(proposal.toolName);
  if (!definition) {
    await markProposalFailed(proposal.proposalId, "unknown action");
    return { ok: false, code: "failed", reason: "That action is no longer supported." };
  }

  if (definition.name === "reschedule_appointment" && !flags.rescheduleEnabled) {
    await markProposalFailed(proposal.proposalId, "reschedule disabled");
    return {
      ok: false,
      code: "disabled",
      reason: "Rescheduling is switched off for this deployment.",
    };
  }

  // Permission is checked again here, not only when the proposal was made: a
  // role can change between proposing and confirming, and the confirmation is
  // the moment that matters.
  if (!principalCan(principal, definition.resource, definition.action)) {
    await markProposalFailed(proposal.proposalId, "permission lost");
    return { ok: false, code: "forbidden", reason: "You are no longer allowed to do that." };
  }

  const ctx = {
    principal,
    now,
    timeZone: CLINIC_TZ,
  } as unknown as Parameters<typeof definition.perform>[1];

  let outcome: Awaited<ReturnType<typeof definition.perform>>;
  try {
    outcome = await definition.perform(proposal.arguments, ctx);
  } catch {
    await markProposalFailed(proposal.proposalId, "unexpected failure");
    return { ok: false, code: "failed", reason: "The action could not be carried out." };
  }

  if (!outcome.ok) {
    // The proposal is spent either way; recording why keeps the audit honest
    // and stops a failed action looking like one that never happened.
    await markProposalFailed(proposal.proposalId, outcome.reason);
    await recordAudit({
      organizationId: principal.organizationId,
      actorUserId: principal.dbUserId,
      action: "assistant_action_failed",
      entityType: "assistant_action_proposal",
      entityId: proposal.proposalId,
      after: { tool: proposal.toolName },
      reason: outcome.reason,
    });
    return { ok: false, code: "failed", reason: outcome.reason };
  }

  await recordAudit({
    organizationId: principal.organizationId,
    actorUserId: principal.dbUserId,
    action: "assistant_action",
    entityType: "assistant_action_proposal",
    entityId: proposal.proposalId,
    after: {
      tool: proposal.toolName,
      summary: proposal.summary,
      result: outcome.result,
    },
    reason: "Confirmed through the assistant",
  });

  return { ok: true, result: outcome.result, message: outcome.message };
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
