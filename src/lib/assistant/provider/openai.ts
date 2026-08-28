import { PartialStringField } from "./partial-json";
import {
  AiProviderError,
  type AiMessage,
  type AiProvider,
  type AiStopReason,
  type AiStreamEvent,
  type AiTurnRequest,
  type AiTurnResponse,
} from "./types";

/**
 * OpenAI-compatible chat completions.
 *
 * Written against the wire protocol rather than a vendor SDK, and against
 * `/chat/completions` rather than OpenAI's newer proprietary endpoint,
 * because that combination is what vLLM, Ollama, TGI and LM Studio all
 * implement. The same class reaches a public API today and a model on your own
 * hardware tomorrow, with a different base URL and key and nothing else.
 */
export class OpenAiProvider implements AiProvider {
  readonly name: string;
  private readonly baseURL: string;
  private readonly model: string;

  constructor(
    private readonly options: {
      apiKey: string;
      baseURL?: string;
      model?: string;
      maxTokens?: number;
      /** Names a self-hosted deployment in logs and audit. */
      label?: string;
    },
  ) {
    this.baseURL = (options.baseURL ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.model = options.model ?? "gpt-5.1";
    this.name = options.label ?? "openai";
  }

  async complete(
    request: AiTurnRequest,
    signal?: AbortSignal,
  ): Promise<AiTurnResponse> {
    return this.send(request, undefined, signal);
  }

  /**
   * Same turn, reporting progress.
   *
   * Two kinds of event, for the two kinds of waiting. `tool_use` fires as soon
   * as the model names the tools it wants, so the app can say what it is doing
   * instead of showing nothing. `delta` carries the answer as it is written —
   * which arrives inside a tool call's arguments, hence the partial reader.
   */
  async stream(
    request: AiTurnRequest,
    onEvent: (event: AiStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<AiTurnResponse> {
    return this.send(request, onEvent, signal);
  }

  private async send(
    request: AiTurnRequest,
    onEvent: ((event: AiStreamEvent) => void) | undefined,
    signal?: AbortSignal,
  ): Promise<AiTurnResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: toChatMessages(request),
      // Passing an empty array makes some servers reject the request outright.
      ...(request.tools.length
        ? {
            tools: request.tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            })),
          }
        : {}),
      [tokenLimitField(this.model)]:
        request.maxOutputTokens ?? this.options.maxTokens ?? 4096,
      ...(onEvent ? { stream: true } : {}),
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      throw new AiProviderError("Could not reach the assistant.", true);
    }

    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      // The provider's own message says which field it rejected. Without it a
      // malformed tool schema looks identical to an outage, and the loop
      // refuses turns for days while nobody knows why. Provider errors
      // describe the request, not the patient, so this is safe to keep.
      const detail = await response.text().catch(() => "");
      throw new AiProviderError(
        `Provider error ${response.status}: ${extractMessage(detail)}`,
        retryable,
      );
    }

    const payload = onEvent
      ? await readStream(response, onEvent)
      : ((await response.json()) as ChatCompletion);
    const choice = payload.choices?.[0];
    if (!choice) {
      throw new AiProviderError("The provider returned no choices.", false);
    }

    return {
      stopReason: mapFinishReason(choice.finish_reason),
      text: choice.message?.content ?? null,
      toolCalls: (choice.message?.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: call.function.name,
        // Arguments arrive as a JSON *string* here, unlike Anthropic's parsed
        // object. Bad JSON is the model's mistake, not a crash: hand back an
        // empty object and let schema validation produce a usable complaint.
        arguments: safeParse(call.function.arguments),
      })),
      usage: payload.usage && {
        inputTokens: payload.usage.prompt_tokens ?? 0,
        outputTokens: payload.usage.completion_tokens ?? 0,
      },
    };
  }
}

/**
 * Reassemble a streamed completion into the same shape as a plain one.
 *
 * The wire format splits everything: text arrives token by token, and a tool
 * call arrives as a name followed by its arguments in fragments. Callers above
 * should not have to know that, so the pieces are joined here and the same
 * object comes back either way.
 */
async function readStream(
  response: Response,
  onEvent: (event: AiStreamEvent) => void,
): Promise<ChatCompletion> {
  const reader = response.body?.getReader();
  if (!reader) throw new AiProviderError("The provider sent no body.", true);

  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finish: string | undefined;
  let usage: ChatCompletion["usage"];
  const calls = new Map<number, { id: string; name: string; args: string }>();
  // Only the final answer is worth showing as it is written; a tool call's
  // other arguments are machinery.
  const answer = new PartialStringField("message");
  let announced = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let cut: number;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line.startsWith("data:")) continue;

      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;

      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(data) as StreamChunk;
      } catch {
        // A malformed frame is not worth failing a turn over.
        continue;
      }

      if (chunk.usage) usage = chunk.usage;
      const delta = chunk.choices?.[0];
      if (!delta) continue;
      if (delta.finish_reason) finish = delta.finish_reason;
      if (delta.delta?.content) {
        text += delta.delta.content;
        onEvent({ type: "delta", text: delta.delta.content });
      }

      for (const call of delta.delta?.tool_calls ?? []) {
        const index = call.index ?? 0;
        const existing = calls.get(index) ?? { id: "", name: "", args: "" };
        if (call.id) existing.id = call.id;
        if (call.function?.name) existing.name = call.function.name;
        if (call.function?.arguments) {
          existing.args += call.function.arguments;
          const fresh = answer.push(call.function.arguments);
          if (fresh) onEvent({ type: "delta", text: fresh });
        }
        calls.set(index, existing);
      }

      // Announce the tools once their names are known, before their arguments
      // finish arriving — that is the part of the wait worth filling.
      if (!announced) {
        const names = [...calls.values()].map((c) => c.name).filter(Boolean);
        if (names.length) {
          announced = true;
          onEvent({ type: "tool_use", names });
        }
      }
    }
  }

  return {
    choices: [
      {
        finish_reason: finish,
        message: {
          content: text || null,
          tool_calls: [...calls.values()]
            .filter((c) => c.name)
            .map((c) => ({
              id: c.id,
              function: { name: c.name, arguments: c.args },
            })),
        },
      },
    ],
    usage,
  };
}

interface StreamChunk {
  choices?: {
    finish_reason?: string;
    delta?: {
      content?: string;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface ChatCompletion {
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: {
        id: string;
        function: { name: string; arguments: string };
      }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * The reasoning models renamed the output cap and reject the old name; most
 * self-hosted servers only know the old one. Picking by model keeps both
 * working without a configuration flag nobody would remember to set.
 */
export function tokenLimitField(model: string): string {
  return /^(gpt-5|gpt-6|o[1-9])/.test(model) ? "max_completion_tokens" : "max_tokens";
}

/** Pull the human-readable reason out of an error body, whatever its shape. */
function extractMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message?.slice(0, 300) ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function mapFinishReason(reason: string | undefined): AiStopReason {
  switch (reason) {
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return "end";
  }
}

/**
 * Our transport-neutral messages into the chat-completions shape.
 *
 * The system prompt is a message here rather than a separate field, and tool
 * results are their own role instead of user content — the two protocols
 * disagree on both, which is exactly the kind of detail the seam exists to
 * keep out of the orchestrator.
 */
function toChatMessages(request: AiTurnRequest): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [
    { role: "system", content: request.system },
  ];

  for (const message of request.messages) {
    messages.push(toChatMessage(message));
  }
  return messages;
}

function toChatMessage(message: AiMessage): Record<string, unknown> {
  if (message.role === "user") {
    return { role: "user", content: message.content };
  }

  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content || null,
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments ?? {}),
              },
            })),
          }
        : {}),
    };
  }

  return {
    role: "tool",
    tool_call_id: message.toolCallId,
    content: message.content,
  };
}
