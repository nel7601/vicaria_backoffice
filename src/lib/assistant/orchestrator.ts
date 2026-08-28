import { zodToJsonSchema } from "./schema-json";
import { OUT_OF_SCOPE_MESSAGE, respondSchema, type TurnOutcome } from "./outcome";
import { buildSystemPrompt } from "./system-prompt";
import {
  ToolInputError,
  ToolNotAvailableError,
  invokeTool,
  toolsFor,
} from "./tools/registry";
import type { ToolContext } from "./tools/types";
import {
  AiProviderError,
  type AiMessage,
  type AiProvider,
  type AiToolSpec,
} from "./provider/types";

/**
 * The tool loop (§4.2 of the assistant plan).
 *
 * The model may ask for tools; the server decides whether each one runs, runs
 * it, and feeds back the result. The loop ends when the model calls `respond`,
 * or when the server stops it — never by running out of patience silently.
 *
 * Deliberately absent: any path where prose from the model causes an action,
 * and any way for the client to supply system instructions or tool results.
 * The conversation the provider sees is assembled here, on the server.
 */

export const RESPOND_TOOL = "respond";

export interface OrchestratorLimits {
  /** Provider round-trips per turn. */
  maxIterations: number;
  /** Tool executions per turn, across all iterations. */
  maxToolCalls: number;
  /** Wall-clock budget for the whole turn. */
  timeoutMs: number;
}

export const DEFAULT_LIMITS: OrchestratorLimits = {
  maxIterations: 6,
  maxToolCalls: 12,
  timeoutMs: 30_000,
};

export interface RunTurnParams {
  provider: AiProvider;
  ctx: ToolContext;
  /** What the user said. Treated as data, never as instructions. */
  input: string;
  limits?: Partial<OrchestratorLimits>;
  now?: () => number;
}

export async function runTurn(params: RunTurnParams): Promise<TurnOutcome> {
  const limits = { ...DEFAULT_LIMITS, ...params.limits };
  const clock = params.now ?? (() => Date.now());
  const deadline = clock() + limits.timeoutMs;
  const { ctx, provider } = params;
  const locale = ctx.principal.locale;

  const available = toolsFor(ctx.principal);
  const toolSpecs: AiToolSpec[] = [
    ...available.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.input),
    })),
    respondToolSpec(),
  ];

  const messages: AiMessage[] = [{ role: "user", content: params.input }];
  const toolsUsed: string[] = [];
  let toolCallBudget = limits.maxToolCalls;

  for (let iteration = 0; iteration < limits.maxIterations; iteration++) {
    if (clock() >= deadline) {
      return serverEnded(locale, toolsUsed, "timeout");
    }

    let response;
    try {
      response = await provider.complete({
        system: buildSystemPrompt(ctx, available.map((t) => t.name)),
        messages,
        tools: toolSpecs,
      });
    } catch (error) {
      if (error instanceof AiProviderError) {
        return serverEnded(locale, toolsUsed, "provider_error");
      }
      throw error;
    }

    // No tool calls means the model answered in prose instead of calling
    // `respond`. Prose is not an outcome, so the turn does not become one.
    if (!response.toolCalls.length) {
      return serverEnded(locale, toolsUsed, "unstructured");
    }

    const finish = response.toolCalls.find((c) => c.name === RESPOND_TOOL);
    if (finish) {
      const parsed = respondSchema.safeParse(finish.arguments);
      if (!parsed.success) {
        return serverEnded(locale, toolsUsed, "unstructured");
      }
      return {
        kind: parsed.data.kind,
        message: parsed.data.message,
        options: parsed.data.options,
        toolsUsed,
      };
    }

    messages.push({
      role: "assistant",
      content: response.text ?? "",
      toolCalls: response.toolCalls,
    });

    for (const call of response.toolCalls) {
      if (toolCallBudget-- <= 0) {
        return serverEnded(locale, toolsUsed, "tool_budget");
      }
      const result = await runOne(call.name, call.arguments, ctx);
      if (result.ok) toolsUsed.push(call.name);
      messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: result.content,
        isError: !result.ok,
      });
    }
  }

  return serverEnded(locale, toolsUsed, "iterations");
}

/**
 * Run one tool call, turning failures into something the model can act on.
 *
 * A refused or malformed call is reported back as a tool result rather than
 * thrown: the model should be able to correct a bad argument on the next
 * iteration. The budget above is what stops it from trying forever.
 */
async function runOne(
  name: string,
  args: unknown,
  ctx: ToolContext,
): Promise<{ ok: boolean; content: string }> {
  try {
    const output = await invokeTool(name, args, ctx);
    return { ok: true, content: JSON.stringify(output) };
  } catch (error) {
    if (error instanceof ToolNotAvailableError) {
      return {
        ok: false,
        content: JSON.stringify({
          error: "tool_not_available",
          message: "That tool is not available. Do not try it again.",
        }),
      };
    }
    if (error instanceof ToolInputError) {
      return {
        ok: false,
        content: JSON.stringify({
          error: "invalid_arguments",
          issues: error.issues,
        }),
      };
    }
    // A genuine failure: say so without leaking internals to the model.
    return {
      ok: false,
      content: JSON.stringify({
        error: "tool_failed",
        message: "The tool could not complete.",
      }),
    };
  }
}

/**
 * The server ending the turn on its own terms.
 *
 * Always a refusal, never a guess. Every reason here means the loop could not
 * establish a grounded answer, and inventing one would be the failure mode the
 * whole design exists to prevent.
 */
function serverEnded(
  locale: "en" | "es",
  toolsUsed: string[],
  reason: string,
): TurnOutcome {
  const message =
    reason === "provider_error"
      ? locale === "es"
        ? "No puedo responder en este momento. Inténtalo de nuevo."
        : "I can't answer right now. Please try again."
      : OUT_OF_SCOPE_MESSAGE[locale];

  return {
    kind: "refusal",
    message,
    toolsUsed,
    terminatedByServer: true,
  };
}

function respondToolSpec(): AiToolSpec {
  return {
    name: RESPOND_TOOL,
    description:
      "End the turn. Every turn must end with this call. Choose 'response' for a grounded " +
      "answer, 'refusal' when the question is outside the Vicaria backoffice or not permitted, " +
      "and 'clarification' when something is ambiguous and you need one more detail.",
    inputSchema: zodToJsonSchema(respondSchema),
  };
}
