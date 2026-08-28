import { NextResponse } from "next/server";
import { z } from "zod";
import { requestPrincipal } from "@/lib/assistant/auth/request-identity";
import { executeProposal } from "@/lib/assistant/actions/execute";
import { assistantFlags } from "@/lib/assistant/flags";
import { assistantError, assistantErrorResponse } from "@/lib/assistant/http";
import { requireTenant } from "@/lib/auth/principal";

/**
 * POST /api/assistant/v1/actions/execute — carry out a confirmed proposal.
 *
 * The body carries an id, not an action. There is no way to describe a write
 * here: whatever happens was decided when the proposal was created and shown,
 * and this endpoint can only perform that or refuse.
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  proposalId: z.uuid(),
  /** Echoed from the proposal, proving the user confirmed what they saw. */
  argumentsHash: z.string().length(64).optional(),
  requestId: z.string().max(100).optional(),
});

export async function POST(request: Request) {
  const flags = assistantFlags();
  if (!flags.assistantEnabled) {
    return assistantError("assistant_disabled", "The assistant is not enabled", 503);
  }
  if (!flags.writeActionsEnabled) {
    return assistantError(
      "write_actions_disabled",
      "Write actions are switched off for this deployment",
      503,
    );
  }

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return assistantError("invalid_request", "A valid proposalId is required", 400);
    }

    const principal = requireTenant(await requestPrincipal(request));
    const outcome = await executeProposal(
      principal,
      parsed.data.proposalId,
      new Date(),
      parsed.data.argumentsHash,
    );

    if (!outcome.ok) {
      // A spent, expired or unknown proposal is a client-side problem, not a
      // server failure: 409 says "the world is not as you assumed".
      const status = outcome.code === "disabled" ? 503 : 409;
      return NextResponse.json(
        { error: outcome.code, message: outcome.reason },
        { status },
      );
    }

    return NextResponse.json({
      ok: true,
      message: outcome.message,
      result: outcome.result,
    });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
