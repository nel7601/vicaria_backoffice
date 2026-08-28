import { ClaudeProvider } from "./claude";
import { UnconfiguredProvider } from "./scripted";
import type { AiProvider } from "./types";

/**
 * Chooses the provider for a turn.
 *
 * The point of the seam: moving from a public model to one you host is an
 * address and a key, not a rewrite. `ASSISTANT_AI_BASE_URL` overrides where
 * requests go, so a private deployment speaking the same protocol drops in
 * without touching the orchestrator, the tools or the routes.
 *
 * Defaults to refusing. A deployment that has not been configured on purpose
 * answers "I can't help with that" rather than quietly reaching for a model
 * nobody chose — and until the privacy review closes, that is the correct
 * behaviour rather than an inconvenience.
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

  return new UnconfiguredProvider();
}

/** Whether a real model is wired in — surfaced by /health so the app can tell. */
export function providerConfigured(): boolean {
  return getProvider().name !== "unconfigured";
}

export type { AiProvider };
