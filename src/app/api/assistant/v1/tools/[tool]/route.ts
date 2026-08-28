import { NextResponse } from "next/server";
import { requestPrincipal } from "@/lib/assistant/auth/request-identity";
import { assistantFlags } from "@/lib/assistant/flags";
import { assistantError, assistantErrorResponse } from "@/lib/assistant/http";
import {
  ToolInputError,
  ToolNotAvailableError,
  invokeTool,
  toolsFor,
} from "@/lib/assistant/tools/registry";
import { requireTenant } from "@/lib/auth/principal";
import { CLINIC_TZ } from "@/lib/domain/timezone";

/**
 * POST /api/assistant/v1/tools/{tool} — run one tool directly.
 *
 * The orchestrator is not the only thing that needs to call a tool: the golden
 * set (§10.4) has to assert what each role gets back, and that has to be
 * checkable without a model in the loop, whose output would vary run to run.
 *
 * It grants nothing extra. Same Bearer, same principal, same registry, same
 * per-invocation permission check — a caller can only reach tools they were
 * already allowed to use, with arguments that satisfy the schema.
 */
export const dynamic = "force-dynamic";

/**
 * One tool is a query or two; this is headroom, not an expectation.
 */
export const maxDuration = 30;

export async function POST(
  request: Request,
  // Written out rather than using the generated RouteContext helper, which
  // only exists after next typegen and so breaks a standalone typecheck.
  ctx: { params: Promise<{ tool: string }> },
) {
  if (!assistantFlags().assistantEnabled) {
    return assistantError(
      "assistant_disabled",
      "The assistant is not enabled for this deployment",
      503,
    );
  }

  try {
    const { tool } = await ctx.params;
    const principal = requireTenant(await requestPrincipal(request));

    let args: unknown = {};
    const body = await request.text();
    if (body.trim()) {
      try {
        args = JSON.parse(body);
      } catch {
        return assistantError("invalid_json", "The body is not valid JSON", 400);
      }
    }

    const result = await invokeTool(tool, args, {
      principal,
      // One instant for the whole call, so a range and a "today" cannot
      // straddle midnight and disagree.
      now: new Date(),
      timeZone: CLINIC_TZ,
    });

    return NextResponse.json({ tool, result });
  } catch (error) {
    if (error instanceof ToolNotAvailableError) {
      return assistantError(
        "tool_not_available",
        "That tool is not available for this user",
        403,
      );
    }
    if (error instanceof ToolInputError) {
      return NextResponse.json(
        {
          error: "invalid_arguments",
          message: "The arguments do not match this tool's schema",
          issues: error.issues,
        },
        { status: 400 },
      );
    }
    return assistantErrorResponse(error);
  }
}

/** GET lists the tools this principal may use — the model's catalogue. */
export async function GET(request: Request) {
  if (!assistantFlags().assistantEnabled) {
    return assistantError(
      "assistant_disabled",
      "The assistant is not enabled for this deployment",
      503,
    );
  }
  try {
    const principal = await requestPrincipal(request);
    return NextResponse.json({
      tools: toolsFor(principal).map((t) => ({
        name: t.name,
        description: t.description,
      })),
    });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
