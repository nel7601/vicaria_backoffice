import { NextResponse } from "next/server";
import { z } from "zod";
import { requestPrincipal } from "@/lib/assistant/auth/request-identity";
import { cancelProposal } from "@/lib/assistant/actions/proposals";
import { assistantFlags } from "@/lib/assistant/flags";
import { assistantError, assistantErrorResponse } from "@/lib/assistant/http";
import { requireTenant } from "@/lib/auth/principal";

/**
 * POST /api/assistant/v1/actions/cancel — withdraw a pending proposal.
 *
 * Cancelling is always allowed while the proposal is pending, and never
 * undoes anything: a proposal that was already carried out stays carried out,
 * and says so.
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({ proposalId: z.uuid() });

export async function POST(request: Request) {
  if (!assistantFlags().assistantEnabled) {
    return assistantError("assistant_disabled", "The assistant is not enabled", 503);
  }

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return assistantError("invalid_request", "A valid proposalId is required", 400);
    }

    const principal = requireTenant(await requestPrincipal(request));
    const result = await cancelProposal(principal, parsed.data.proposalId);

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.reason,
          message:
            result.reason === "already_used"
              ? "That action was already carried out and cannot be cancelled."
              : "There is no pending action with that id.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, message: "The action was cancelled." });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
