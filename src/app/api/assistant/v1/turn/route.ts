import { NextResponse } from "next/server";
import { z } from "zod";
import { requestPrincipal } from "@/lib/assistant/auth/request-identity";
import { assistantFlags } from "@/lib/assistant/flags";
import { assistantError, assistantErrorResponse } from "@/lib/assistant/http";
import {
  conversationMemoryAvailable,
  extendConversation,
  openConversation,
} from "@/lib/assistant/conversation";
import { runTurn, type TurnEvent } from "@/lib/assistant/orchestrator";
import { DEFAULT_PROFILE, profileSchema } from "@/lib/assistant/persona";
import { getProvider } from "@/lib/assistant/provider";
import { recordAudit } from "@/lib/audit/record";
import { requireTenant } from "@/lib/auth/principal";
import { CLINIC_TZ } from "@/lib/domain/timezone";
import { checkRateLimit } from "@/lib/security/durable-rate-limit";

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

/**
 * A grounded answer means a model round-trip, tools, and another
 * round-trip to read them: 5-15s is normal and the platform default of 10s
 * would cut the interesting questions in half. Streaming does not exempt it —
 * the limit is on the function, not the first byte.
 */
export const maxDuration = 60;

/** SEC-07: a turn is expensive, so cap it per user rather than per IP. */
const TURN_LIMIT = 20;
const TURN_WINDOW_SECONDS = 60;

const bodySchema = z.object({
  /** What the user said or typed. Treated as data, never as instruction. */
  input: z.string().trim().min(1).max(2000),
  locale: z.enum(["en", "es"]).optional(),
  /**
   * The sealed history returned by the previous turn.
   *
   * The client carries it but cannot read or alter it: it is encrypted and
   * authenticated against the user, so this is still not a channel for
   * rewriting the past. Carrying it removes the need for a shared store, which
   * is what makes the assistant work across serverless instances.
   */
  conversation: z.string().max(131072).optional(),
  /**
   * How the user is interacting. Voice answers are phrased for listening —
   * the permissions do not change, only the wording.
   */
  channel: z.enum(["text", "voice"]).default("text"),
  /**
   * Ask for server-sent events instead of one JSON reply. A grounded answer
   * takes seconds; in voice that is silence with nothing to show for it.
   */
  stream: z.boolean().default(false),
  /**
   * How this person likes to be addressed. Held by the client because it is
   * a preference, not a permission — nothing here changes what may be seen.
   */
  profile: profileSchema.optional(),
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

    const decision = await checkRateLimit(
      `turn:${principal.authUserId}`,
      TURN_LIMIT,
      TURN_WINDOW_SECONDS,
    );
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

    const carried = conversationMemoryAvailable()
      ? parsed.data.conversation
      : undefined;
    const history = openConversation(principal.authUserId, carried);

    const ctx = {
      principal,
      now: new Date(),
      timeZone: CLINIC_TZ,
      channel: parsed.data.channel,
    };

    if (parsed.data.stream) {
      return streamTurn({
        principal,
        ctx,
        input: parsed.data.input,
        history,
        carried,
        profile: parsed.data.profile ?? DEFAULT_PROFILE,
        requestId: parsed.data.requestId,
      });
    }

    const outcome = await runTurn({
      provider: getProvider(),
      ctx,
      input: parsed.data.input,
      history,
      profile: parsed.data.profile ?? DEFAULT_PROFILE,
    });

    // Reseal so the next turn can refer back to this one. Refusals are carried
    // too: "why not?" is a reasonable follow-up.
    const conversation = conversationMemoryAvailable()
      ? extendConversation(
          principal.authUserId,
          carried,
          parsed.data.input,
          outcome.message,
        )
      : undefined;

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
        requestId: parsed.data.requestId,
      },
    });

    return NextResponse.json({
      kind: outcome.kind,
      message: outcome.message,
      spoken: outcome.spoken,
      options: outcome.options,
      toolsUsed: outcome.toolsUsed,
      proposal: outcome.proposal,
      conversation,
    });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}

/**
 * The same turn as server-sent events.
 *
 * Events are progress, not the answer: `status` says what is being looked up,
 * `delta` carries the reply as it forms, and `done` is authoritative. A client
 * that only reads `done` behaves exactly like the non-streaming caller — which
 * matters, because the deltas come from a partially-parsed tool call and the
 * final parse is the one that decides the outcome.
 */
function streamTurn(params: {
  principal: Awaited<ReturnType<typeof requestPrincipal>> & {
    organizationId: string;
    dbUserId: string;
  };
  ctx: Parameters<typeof runTurn>[0]["ctx"];
  input: string;
  history: Parameters<typeof runTurn>[0]["history"];
  carried?: string;
  profile: Parameters<typeof runTurn>[0]["profile"];
  requestId?: string;
}): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const outcome = await runTurn({
          provider: getProvider(),
          ctx: params.ctx,
          input: params.input,
          history: params.history,
          profile: params.profile,
          onEvent: (event: TurnEvent) => {
            if (event.type === "delta") send("delta", { text: event.text });
            else if (event.type === "tools_requested") {
              if (event.names.length) send("status", { looking_up: event.names });
            } else send("status", { finished: event.name, ok: event.ok });
          },
        });

        const conversation = conversationMemoryAvailable()
          ? extendConversation(
              params.principal.authUserId,
              params.carried,
              params.input,
              outcome.message,
            )
          : undefined;

        await recordAudit({
          organizationId: params.principal.organizationId,
          actorUserId: params.principal.dbUserId,
          action: "assistant_turn",
          entityType: "assistant",
          after: {
            outcome: outcome.kind,
            toolsUsed: outcome.toolsUsed,
            terminatedByServer: outcome.terminatedByServer ?? false,
            requestId: params.requestId,
            streamed: true,
          },
        });

        send("done", {
          kind: outcome.kind,
          message: outcome.message,
          spoken: outcome.spoken,
          options: outcome.options,
          toolsUsed: outcome.toolsUsed,
          proposal: outcome.proposal,
          conversation,
        });
      } catch {
        // The status line is already 200 by now, so a failure has to travel as
        // an event. A client that sees this and no `done` knows the turn died.
        send("error", {
          error: "turn_failed",
          message: "The assistant could not finish that turn.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Vercel and most proxies buffer responses unless told not to, which
      // would defeat the point entirely.
      "X-Accel-Buffering": "no",
    },
  });
}
