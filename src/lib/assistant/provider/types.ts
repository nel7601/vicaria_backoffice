/**
 * The AI provider seam (§3 of the assistant plan).
 *
 * Nothing above this interface knows which model is behind it. That matters
 * for two reasons: the provider is a processor of PHI and may have to be
 * swapped for contractual rather than technical reasons, and the orchestrator
 * has to be testable without a model, whose output varies run to run.
 *
 * A provider never touches the database, never sees credentials, and never
 * decides anything: it reads a conversation and asks for tools by name.
 */

/** A tool as described to the model. Schemas are JSON Schema, not Zod. */
export interface AiToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AiToolCall {
  /** Provider-assigned id, echoed back with the result. */
  id: string;
  name: string;
  arguments: unknown;
}

export type AiMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: AiToolCall[] }
  | {
      role: "tool";
      toolCallId: string;
      name: string;
      /** Serialised tool result, or an error the model should recover from. */
      content: string;
      isError?: boolean;
    };

export interface AiTurnRequest {
  /** Built by the server every turn. Never contains data from the database. */
  system: string;
  messages: AiMessage[];
  tools: AiToolSpec[];
  maxOutputTokens?: number;
}

export type AiStopReason =
  /** The model wants tools run and the loop to continue. */
  | "tool_use"
  /** The model finished. */
  | "end"
  /** The provider cut the response short. */
  | "max_tokens"
  /** The provider itself refused to answer. */
  | "refusal";

export interface AiTurnResponse {
  stopReason: AiStopReason;
  /** Free text the model produced. Never used to decide anything. */
  text: string | null;
  toolCalls: AiToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AiProvider {
  /** Identifies the implementation in logs and audit, e.g. "claude", "scripted". */
  readonly name: string;
  complete(
    request: AiTurnRequest,
    signal?: AbortSignal,
  ): Promise<AiTurnResponse>;
}

/** Raised for provider failures the orchestrator should surface, not retry blindly. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
