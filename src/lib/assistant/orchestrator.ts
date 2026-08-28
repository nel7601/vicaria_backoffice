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
  /**
   * Earlier turns of this conversation, so "and next week?" resolves.
   * Server-held: the client never supplies history, only its id.
   */
  history?: AiMessage[];
  limits?: Partial<OrchestratorLimits>;
  now?: () => number;
  /**
   * Called as the turn progresses, when supplied. The turn's result is
   * unchanged by it: these are for filling the wait, not for deciding
   * anything, and a caller that ignores them gets the same answer.
   */
  onEvent?: (event: TurnEvent) => void;
}

/** What a caller can show while a turn is still being worked out. */
export type TurnEvent =
  /** The model is asking for these tools; the server has not run them yet. */
  | { type: "tools_requested"; names: string[] }
  /** A tool finished. `ok` is false when it was refused or failed. */
  | { type: "tool_done"; name: string; ok: boolean }
  /** A fragment of the answer, as it is written. */
  | { type: "delta"; text: string };

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

  const messages: AiMessage[] = [
    ...(params.history ?? []),
    { role: "user", content: params.input },
  ];
  const toolsUsed: string[] = [];
  let toolCallBudget = limits.maxToolCalls;

  for (let iteration = 0; iteration < limits.maxIterations; iteration++) {
    if (clock() >= deadline) {
      return serverEnded(locale, toolsUsed, "timeout");
    }

    const providerRequest = {
      system: buildSystemPrompt(ctx, available.map((t) => t.name)),
      messages,
      tools: toolSpecs,
    };

    let response;
    try {
      response =
        params.onEvent && provider.stream
          ? await provider.stream(providerRequest, (event) => {
              if (event.type === "delta") {
                params.onEvent?.({ type: "delta", text: event.text });
              } else {
                // `respond` is the turn ending, not work being done. Filtering
                // it can leave nothing, and an empty "looking up…" is worse
                // than no event at all — so it is dropped here rather than in
                // each consumer.
                const names = event.names.filter((n) => n !== RESPOND_TOOL);
                if (names.length) {
                  params.onEvent?.({ type: "tools_requested", names });
                }
              }
            })
          : await provider.complete(providerRequest);
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
        spoken: parsed.data.spoken,
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
      params.onEvent?.({ type: "tool_done", name: call.name, ok: result.ok });
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
      "End the turn. Every turn must end with this call.\n" +
      "- 'response': you answered, grounded in tool results.\n" +
      "- 'clarification': you could answer but need one detail first — an ambiguous name, " +
      "a date that could mean two things, or a reference like 'those' you cannot resolve. " +
      "Asking is not refusing: use this whenever the question is legitimate and answerable " +
      "once the user tells you which one they meant.\n" +
      "- 'refusal': the question is outside the Vicaria backoffice, or this user is not " +
      "permitted to know. Use it only when no clarification would make it answerable.",
    inputSchema: zodToJsonSchema(respondSchema),
  };
}
