import { timingSafeEqual } from "node:crypto";
import { executeProposal } from "@/lib/assistant/actions/execute";
import { cancelProposal } from "@/lib/assistant/actions/proposals";
import { assistantFlags } from "@/lib/assistant/flags";
import {
  ToolInputError,
  ToolNotAvailableError,
  invokeTool,
} from "@/lib/assistant/tools/registry";
import { CLINIC_TZ } from "@/lib/domain/timezone";
import { vikiPrincipal, VikiIdentityError } from "@/lib/viki/identity";

/**
 * POST /api/viki/tool/[name] — run one tool, for a voice agent that cannot
 * speak MCP.
 *
 * The plan the voice platform is on does not include MCP servers, so the same
 * catalogue is published a second way: one webhook per tool, all of them
 * landing here. Nothing about what a tool does changes — this is a different
 * doorway to `invokeTool`, not a different set of rules — and it shares the
 * MCP endpoint's secret, so there is one credential to rotate rather than two.
 *
 * Errors come back as data rather than as HTTP failures. A model handed a 400
 * tends to apologise and stop; a model handed `{"error": "...", "issues": [...]}`
 * usually fixes the argument and tries again, which is what should happen when
 * it guessed a date format wrong.
 */
export const dynamic = "force-dynamic";

export const maxDuration = 45;

function tokenMatches(offered: string, expected: string): boolean {
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ name: string }> },
) {
  const flags = assistantFlags();
  if (!flags.assistantEnabled) {
    return Response.json({ error: "assistant_disabled" }, { status: 503 });
  }

  const expected = setting("MCP_TOKEN");
  if (!expected) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  const [scheme, offered] = header.split(" ");
  if (!offered || scheme.toLowerCase() !== "bearer" || !tokenMatches(offered.trim(), expected)) {
    return Response.json({ error: "invalid_token" }, { status: 401 });
  }

  const { name } = await context.params;
  const args = await request.json().catch(() => ({}));

  let principal: Awaited<ReturnType<typeof vikiPrincipal>>;
  try {
    principal = await vikiPrincipal();
  } catch (error) {
    if (error instanceof VikiIdentityError) {
      return Response.json({ error: "not_configured", message: error.message }, { status: 503 });
    }
    throw error;
  }

  const ctx = {
    principal,
    now: new Date(),
    timeZone: CLINIC_TZ,
    // The answers are going to be spoken, so they should be written to be
    // heard: short, no lists read out loud, no identifiers said aloud.
    channel: "voice" as const,
  };

  try {
    // The two that complete a write live here rather than in the catalogue:
    // the catalogue proposes, and confirming was always meant to be a separate
    // act. In Viki that act is a spoken yes instead of a button.
    if (name === "confirm_action") {
      if (!flags.writeActionsEnabled) {
        return Response.json({ done: false, reason: "Las escrituras están desactivadas." });
      }
      const outcome = await executeProposal(principal, String(args.proposalId), new Date());
      return Response.json(
        outcome.ok
          ? { done: true, message: outcome.message, result: outcome.result }
          : { done: false, reason: outcome.reason },
      );
    }

    if (name === "cancel_action") {
      return Response.json(await cancelProposal(principal, String(args.proposalId)));
    }

    return Response.json(await invokeTool(name, args, ctx));
  } catch (error) {
    if (error instanceof ToolNotAvailableError) {
      return Response.json({
        error: "tool_not_available",
        message: "Esa herramienta no existe. No lo intentes otra vez.",
      });
    }
    if (error instanceof ToolInputError) {
      return Response.json({ error: "invalid_arguments", issues: error.issues });
    }
    console.error(`[viki] ${name} falló`, error);
    return Response.json({
      error: "tool_failed",
      message: "La herramienta no pudo completarse.",
    });
  }
}

/**
 * Read a setting under its current name, falling back to what it used to be
 * called.
 *
 * The app was called Yise while it was being built. Renaming the variables and
 * the deployment cannot happen in the same instant, and whichever goes first
 * would otherwise take the clinic's voice down until the other caught up.
 */
function setting(name: string): string | undefined {
  return (process.env[`VIKI_${name}`] ?? process.env[`YISE_${name}`])?.trim();
}
