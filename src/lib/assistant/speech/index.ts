import { WhisperProvider } from "./whisper";
import { UnconfiguredSpeechProvider, type SpeechProvider } from "./types";

/**
 * Chooses the speech provider.
 *
 * Same shape as the AI provider factory, and for the same reason: pointing
 * this at your own Whisper deployment is a base URL and a key, with no code
 * change. `ASSISTANT_STT_LABEL` lets a self-hosted deployment identify itself
 * in the audit trail rather than reading as "whisper" forever.
 */
export function getSpeechProvider(): SpeechProvider {
  const provider = (process.env.ASSISTANT_STT_PROVIDER ?? "").toLowerCase();

  if (provider === "whisper" || provider === "openai") {
    const apiKey = process.env.ASSISTANT_STT_API_KEY;
    const baseURL = process.env.ASSISTANT_STT_BASE_URL ?? "https://api.openai.com/v1";
    if (!apiKey) return new UnconfiguredSpeechProvider();
    return new WhisperProvider({
      apiKey,
      baseURL,
      model: process.env.ASSISTANT_STT_MODEL,
      label: process.env.ASSISTANT_STT_LABEL,
    });
  }

  return new UnconfiguredSpeechProvider();
}

export function speechConfigured(): boolean {
  return getSpeechProvider().name !== "unconfigured";
}

export type { SpeechProvider };
