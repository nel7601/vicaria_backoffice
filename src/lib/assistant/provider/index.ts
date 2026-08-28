import { ClaudeProvider } from "./claude";
import { OpenAiProvider } from "./openai";
import { UnconfiguredProvider } from "./scripted";
import type { AiProvider } from "./types";

/**
 * Chooses the provider for a turn.
 *
 * The default is the OpenAI-compatible one, and that is a decision about where
 * this is going rather than about which model is better today. Self-hosted
 * servers — vLLM, Ollama, TGI — speak the chat-completions protocol, so the
 * same implementation that talks to a public API now will talk to your own
 * hardware later with a different `ASSISTANT_AI_BASE_URL`. Claude stays
 * available behind the same seam for anyone who wants it.
 *
 * With nothing configured, every turn is refused rather than quietly routed to
 * a model nobody chose.
 */
export function getProvider(): AiProvider {
  const provider = (process.env.ASSISTANT_AI_PROVIDER ?? "").toLowerCase();

  if (provider === "claude" || provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return new UnconfiguredProvider();
    return new ClaudeProvider({
      apiKey,
      model: process.env.ASSISTANT_AI_MODEL,
      baseURL: process.env.ASSISTANT_AI_BASE_URL,
    });
  }

  // "openai" for the public API, "local"/"selfhosted" for anything speaking
  // the same protocol — the code path is identical, the label is not, so audit
  // records which one answered.
  if (["openai", "local", "selfhosted", "vllm", "ollama"].includes(provider)) {
    const apiKey = process.env.ASSISTANT_AI_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!apiKey) return new UnconfiguredProvider();
    return new OpenAiProvider({
      apiKey,
      baseURL: process.env.ASSISTANT_AI_BASE_URL,
      model: process.env.ASSISTANT_AI_MODEL,
      label: process.env.ASSISTANT_AI_LABEL ?? (provider === "openai" ? "openai" : provider),
    });
  }

  return new UnconfiguredProvider();
}

export function providerConfigured(): boolean {
  return getProvider().name !== "unconfigured";
}

export type { AiProvider };
