import {
  AiProviderError,
  type AiProvider,
  type AiStreamEvent,
  type AiTurnRequest,
  type AiTurnResponse,
} from "./types";

/**
 * A provider that replays a fixed script instead of calling a model.
 *
 * The orchestrator's job — enforcing limits, running only permitted tools,
 * refusing to act on free text — has to hold whatever the model does, including
 * when it misbehaves. A real model cannot be made to misbehave on demand, so
 * the adversarial cases (asking for a forbidden tool, looping forever, never
 * finishing) are driven from here.
 *
 * It is also what runs when no model is configured, so the assistant can be
 * built and exercised end to end before any PHI is sent to a third party.
 */
export class ScriptedProvider implements AiProvider {
  readonly name = "scripted";
  private index = 0;

  /** Requests seen so far — lets tests assert what the model was shown. */
  readonly seen: AiTurnRequest[] = [];

  constructor(private readonly script: AiTurnResponse[]) {}

  async complete(request: AiTurnRequest): Promise<AiTurnResponse> {
    this.seen.push(request);
    const next = this.script[this.index++];
    if (!next) {
      throw new AiProviderError(
        `Scripted provider ran out of responses after ${this.index - 1}.`,
        false,
      );
    }
    return next;
  }

  /**
   * Replays the same script while emitting the events a real provider would.
   *
   * Tool names are announced before the answer, and the answer arrives in
   * fragments, so callers can be tested against the shape of a stream without
   * a network or a model.
   */
  async stream(
    request: AiTurnRequest,
    onEvent: (event: AiStreamEvent) => void,
  ): Promise<AiTurnResponse> {
    const response = await this.complete(request);

    if (response.toolCalls.length) {
      onEvent({ type: "tool_use", names: response.toolCalls.map((c) => c.name) });
    }

    for (const call of response.toolCalls) {
      const message = (call.arguments as { message?: unknown } | undefined)?.message;
      if (typeof message !== "string") continue;
      // Split into fixed-size pieces so tests see genuine fragmentation,
      // including across newlines.
      for (let i = 0; i < message.length; i += 12) {
        onEvent({ type: "delta", text: message.slice(i, i + 12) });
      }
    }

    return response;
  }
}

/**
 * The provider used when the assistant is switched on but no model is
 * configured. It refuses every turn rather than failing obscurely, so a
 * misconfigured deployment degrades into "I can't answer that" instead of a
 * 500 — and never silently falls back to some other model.
 */
export class UnconfiguredProvider implements AiProvider {
  readonly name = "unconfigured";

  async complete(): Promise<AiTurnResponse> {
    throw new AiProviderError("No AI provider is configured.", false);
  }
}
