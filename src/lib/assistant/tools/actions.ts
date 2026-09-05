import { principalCan } from "@/lib/auth/authorize-principal";
import { createProposal, hashArguments } from "../actions/proposals";
import { allActions } from "../actions/catalog";
import { assistantFlags } from "../flags";
import type { AssistantTool, ToolContext } from "./types";

// Importing the definitions is what registers them.
import "../actions/definitions";

/**
 * One proposal tool per action in the catalogue.
 *
 * Generated rather than written out: every write behaves the same way — check
 * the permission, resolve the arguments against current state, describe the
 * effect, store it, and hand back something a person must confirm. Writing
 * that twelve times invites the twelfth to be subtly different, and the
 * difference would be in the part that decides whether a person is asked.
 *
 * None of these change anything. They return a proposal id; the change happens
 * in /actions/execute, after a confirmation.
 */
export function buildActionTools(): AssistantTool[] {
  return allActions().map((definition) => {
    const tool: AssistantTool<unknown, unknown> = {
      name: definition.name,
      description:
        `${definition.description}\n` +
        "This does NOT perform the action: it returns a proposal the user must confirm. " +
        "Tell them exactly what will happen, using absolute dates and amounts, and wait." +
        (definition.irreversible
          ? " This action cannot be undone — say so when asking."
          : ""),
      resource: definition.resource,
      action: definition.action,
      input: definition.input,

      isAvailable(principal) {
        const flags = assistantFlags();
        if (!flags.writeActionsEnabled) return false;
        // Rescheduling keeps its own switch: it was the pilot's single action
        // and the plan gates it separately from the rest.
        if (definition.name === "reschedule_appointment" && !flags.rescheduleEnabled) {
          return false;
        }
        return principalCan(principal, definition.resource, definition.action);
      },

      async execute(args, ctx: ToolContext) {
        if (!principalCan(ctx.principal, definition.resource, definition.action)) {
          return { proposed: false, reason: "No tienes permiso para eso." };
        }

        const prepared = await definition.prepare(args, ctx);
        if (!prepared.ok) return { proposed: false, reason: prepared.reason };

        const proposal = await createProposal(
          ctx.principal,
          {
            toolName: definition.name,
            arguments: prepared.arguments,
            summary: prepared.summary,
          },
          ctx.now,
        );

        return {
          proposed: true,
          proposalId: proposal.proposalId,
          // Echoed back on confirmation to prove the user agreed to this and
          // not to whatever that id points at later.
          argumentsHash: hashArguments(prepared.arguments),
          // Seconds, not a timestamp: a proposal lives for a couple of minutes,
          // and "you have 90 seconds" is both what the user needs and the one
          // form the model cannot misread into the wrong timezone.
          expiresInSeconds: Math.max(
            0,
            Math.round((proposal.expiresAt.getTime() - ctx.now.getTime()) / 1000),
          ),
          summary: prepared.summary,
          irreversible: definition.irreversible ?? false,
          guidance:
            "Read the summary back to the user, exactly as written, and wait for them to " +
            "confirm. You cannot confirm on their behalf.",
        };
      },
    };
    return tool as AssistantTool;
  });
}
