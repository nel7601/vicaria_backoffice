import Anthropic from "@anthropic-ai/sdk";
import {
  AiProviderError,
  type AiMessage,
  type AiProvider,
  type AiTurnRequest,
  type AiTurnResponse,
  type AiStopReason,
} from "./types";

/**
 * Claude behind the AiProvider seam.
 *
 * Everything provider-specific stops here: message shapes, tool-call encoding,
 * stop reasons. The orchestrator above knows none of it, which is what makes
 * swapping in a self-hosted model later a matter of writing a sibling of this
 * file rather than touching the loop.
 *
 * `baseURL` is configurable for exactly that reason: a private deployment
 * speaking the same protocol needs only an address and a key.
 */
export class ClaudeProvider implements AiProvider {
  readonly name = "claude";
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: {
    apiKey: string;
    model?: string;
    baseURL?: string;
    maxTokens?: number;
  }) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
    this.model = options.model ?? "claude-opus-5";
    this.maxTokens = options.maxTokens ?? 4096;
  }

  async complete(
    request: AiTurnRequest,
    signal?: AbortSignal,
  ): Promise<AiTurnResponse> {
    try {
      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: request.maxOutputTokens ?? this.maxTokens,
          // The clinic's staff are between patients: think, but briefly.
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          system: request.system,
          messages: toAnthropicMessages(request.messages),
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema as Anthropic.Tool["input_schema"],
          })),
        },
        { signal },
      );

      return {
        stopReason: mapStopReason(response.stop_reason),
        text:
          response.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("\n") || null,
        toolCalls: response.content
          .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
          .map((b) => ({ id: b.id, name: b.name, arguments: b.input })),
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (error) {
      throw asProviderError(error);
    }
  }
}

/**
 * Our transport-neutral messages into Anthropic's shape.
 *
 * Tool results have to be user-role content blocks, and consecutive ones must
 * be merged into a single message: splitting them teaches the model to stop
 * asking for tools in parallel.
 */
function toAnthropicMessages(messages: AiMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
      continue;
    }

    if (message.role === "assistant") {
      const content: Anthropic.ContentBlockParam[] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments as Record<string, unknown>,
        });
      }
      if (content.length) out.push({ role: "assistant", content });
      continue;
    }

    const block: Anthropic.ToolResultBlockParam = {
      type: "tool_result",
      tool_use_id: message.toolCallId,
      content: message.content,
      ...(message.isError ? { is_error: true } : {}),
    };

    const last = out[out.length - 1];
    if (last?.role === "user" && Array.isArray(last.content)) {
      last.content.push(block);
    } else {
      out.push({ role: "user", content: [block] });
    }
  }

  return out;
}

function mapStopReason(reason: string | null): AiStopReason {
  switch (reason) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "end";
  }
}

/**
 * Classify failures so the orchestrator can tell "try again" from "this will
 * never work". A rate limit or a 5xx is worth retrying; a bad request is a bug
 * in what we sent.
 */
function asProviderError(error: unknown): AiProviderError {
  if (error instanceof Anthropic.RateLimitError) {
    return new AiProviderError("The assistant is rate limited.", true);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiProviderError("Could not reach the assistant.", true);
  }
  if (error instanceof Anthropic.APIError) {
    const retryable = typeof error.status === "number" && error.status >= 500;
    return new AiProviderError(`Provider error ${error.status}.`, retryable);
  }
  return new AiProviderError("Unexpected provider failure.", false);
}
