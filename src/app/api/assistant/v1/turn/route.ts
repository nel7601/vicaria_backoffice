import { NextResponse } from "next/server";
import { z } from "zod";
import { requestPrincipal } from "@/lib/assistant/auth/request-identity";
import { assistantFlags } from "@/lib/assistant/flags";
import { assistantError, assistantErrorResponse } from "@/lib/assistant/http";
import { appendExchange, loadConversation } from "@/lib/assistant/conversation";
import { runTurn } from "@/lib/assistant/orchestrator";
import { getProvider } from "@/lib/assistant/provider";
import { recordAudit } from "@/lib/audit/record";
import { requireTenant } from "@/lib/auth/principal";
import { CLINIC_TZ } from "@/lib/domain/timezone";
import { InMemoryRateLimiter } from "@/lib/security/rate-limit";

/**
 * POST /api/assistant/v1/turn — one turn of the conversation (§4.2).
 *
 * The client sends what the user said and nothing else. It cannot send system
 * instructions, tool results, or a message history with roles it controls: the
 * server owns the conversation, so no shape of request can tell the model it
 * is allowed to do something it is not.
 *
 * The response is JSON for now. Streaming arrives with the real provider; the
 * outcome contract does not change when it does.
 */
export const dynamic = "force-dynamic";

/** SEC-07: a turn is expensive, so cap it per user rather than per IP. */
const turnLimiter = new InMemoryRateLimiter(20, 60_000);

const bodySchema = z.object({
  /** What the user said or typed. Treated as data, never as instruction. */
  input: z.string().trim().min(1).max(2000),
  locale: z.enum(["en", "es"]).optional(),
  /**
   * Which conversation this belongs to. The client supplies an id, never the
   * history itself: the server holds what was said, so nothing the client
   * sends can rewrite the past.
   */
  conversationId: z.string().min(1).max(100).optional(),
  /** Client-generated, for idempotency and for correlating logs. */
  requestId: z.string().max(100).optional(),
});

export async function POST(request: Request) {
  if (!assistantFlags().assistantEnabled) {
    return assistantError(
      "assistant_disabled",
      "The assistant is not enabled for this deployment",
      503,
    );
  }

  try {
    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return assistantError(
        "invalid_request",
        parsed.error.issues[0]?.message ?? "Invalid request body",
        400,
      );
    }

    const principal = requireTenant(
      await requestPrincipal(request, parsed.data.locale ?? "en"),
    );

    const decision = turnLimiter.check(`turn:${principal.authUserId}`);
    if (!decision.allowed) {
      return NextResponse.json(
        {
          error: "rate_limited",
          message: "Too many requests. Wait a moment and try again.",
          retryAfter: Math.max(0, Math.ceil((decision.resetAt - Date.now()) / 1000)),
        },
        { status: 429 },
      );
    }

    const conversationId = parsed.data.conversationId;
    const history = conversationId
      ? loadConversation(principal.authUserId, conversationId)
      : [];

    const outcome = await runTurn({
      provider: getProvider(),
      ctx: { principal, now: new Date(), timeZone: CLINIC_TZ },
      input: parsed.data.input,
      history,
    });

    // Remember the exchange so the next turn can refer back to it. Refusals
    // are recorded too: "why not?" is a reasonable follow-up.
    if (conversationId) {
      appendExchange(
        principal.authUserId,
        conversationId,
        parsed.data.input,
        outcome.message,
      );
    }

    // Audit the turn, never its content: the question and the answer are PHI
    // in every way that matters (SEC-06, §8.6).
    await recordAudit({
      organizationId: principal.organizationId,
      actorUserId: principal.dbUserId,
      action: "assistant_turn",
      entityType: "assistant",
      after: {
        outcome: outcome.kind,
        toolsUsed: outcome.toolsUsed,
        terminatedByServer: outcome.terminatedByServer ?? false,
        conversationId,
        requestId: parsed.data.requestId,
      },
    });

    return NextResponse.json({
      kind: outcome.kind,
      message: outcome.message,
      options: outcome.options,
      toolsUsed: outcome.toolsUsed,
      conversationId,
    });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
