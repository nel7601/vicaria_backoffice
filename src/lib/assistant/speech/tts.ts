import { SpeechProviderError } from "./types";

/**
 * Turning Viki's words into a voice.
 *
 * The phone can already speak — every Android has a text-to-speech engine —
 * and it sounds like a phone. For something a person talks to all day that
 * difference is not cosmetic: a flat, clipped voice makes an assistant feel
 * like a machine being operated rather than someone being asked.
 *
 * Synthesised on the server for the same reasons as recognition: the voice is
 * identical on every device, the provider key never leaves the server, and
 * changing provider later is an address and a key.
 *
 * Only the spoken form is sent — one or two sentences — so the cost and the
 * latency stay small, and names the screen can carry never go over the wire
 * to be read aloud.
 */

/** Warm and unhurried; the closest to a person rather than an announcer. */
export const DEFAULT_VOICE = "shimmer";

/** Voices worth offering. Others exist; these are the ones that fit. */
export const VOICES = ["shimmer", "coral", "sage", "nova", "alloy"] as const;
export type Voice = (typeof VOICES)[number];

/**
 * How to say it, not what to say.
 *
 * gpt-4o-mini-tts takes direction, which matters more than the voice itself:
 * the same voice reading a clinic's schedule should sound calm and clear, not
 * bright and salesy.
 */
const DELIVERY =
  "Habla con calidez y naturalidad, como una secretaria profesional que conoce " +
  "a la persona. Ritmo tranquilo, sin prisa y sin entusiasmo impostado. " +
  "Pronuncia los nombres propios con claridad.";

const DELIVERY_EN =
  "Speak warmly and naturally, like a professional assistant who knows the " +
  "person. Calm pace, unhurried, without forced enthusiasm. Pronounce proper " +
  "names clearly.";

export interface SpeakRequest {
  text: string;
  voice?: Voice;
  language?: "es" | "en";
  /** 0.25–4.0; below 1 is slower. */
  speed?: number;
}

export interface TtsProvider {
  readonly name: string;
  speak(request: SpeakRequest, signal?: AbortSignal): Promise<ArrayBuffer>;
}

/**
 * OpenAI-compatible speech synthesis.
 *
 * Written against the wire format, so a self-hosted server speaking the same
 * contract needs only a different base URL.
 */
export class OpenAiTtsProvider implements TtsProvider {
  readonly name: string;

  constructor(
    private readonly options: {
      apiKey: string;
      baseURL?: string;
      model?: string;
      label?: string;
    },
  ) {
    this.name = options.label ?? "openai-tts";
  }

  async speak(request: SpeakRequest, signal?: AbortSignal): Promise<ArrayBuffer> {
    const base = (this.options.baseURL ?? "https://api.openai.com/v1").replace(/\/$/, "");

    let response: Response;
    try {
      response = await fetch(`${base}/audio/speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.options.model ?? "gpt-4o-mini-tts",
          voice: request.voice ?? DEFAULT_VOICE,
          input: request.text,
          instructions: request.language === "en" ? DELIVERY_EN : DELIVERY,
          // mp3 plays on Android without extra work and is small enough that
          // the download is not what the user waits for.
          response_format: "mp3",
          ...(request.speed ? { speed: request.speed } : {}),
        }),
        signal,
      });
    } catch {
      throw new SpeechProviderError("Could not reach the speech service.", true);
    }

    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      throw new SpeechProviderError(`Speech service returned ${response.status}.`, retryable);
    }

    return response.arrayBuffer();
  }
}

export class UnconfiguredTtsProvider implements TtsProvider {
  readonly name = "unconfigured";
  async speak(): Promise<ArrayBuffer> {
    throw new SpeechProviderError("No speech synthesis is configured.", false);
  }
}

/**
 * Falls back to the same key as transcription: they are the same provider in
 * every deployment so far, and asking for two keys to reach one service is
 * configuration for its own sake.
 */
export function getTtsProvider(): TtsProvider {
  const provider = (
    process.env.ASSISTANT_TTS_PROVIDER ?? process.env.ASSISTANT_STT_PROVIDER ?? ""
  ).toLowerCase();
  if (!["openai", "whisper", "local", "selfhosted"].includes(provider)) {
    return new UnconfiguredTtsProvider();
  }

  const apiKey = process.env.ASSISTANT_TTS_API_KEY ?? process.env.ASSISTANT_STT_API_KEY;
  if (!apiKey) return new UnconfiguredTtsProvider();

  return new OpenAiTtsProvider({
    apiKey,
    baseURL: process.env.ASSISTANT_TTS_BASE_URL,
    model: process.env.ASSISTANT_TTS_MODEL,
    label: process.env.ASSISTANT_TTS_LABEL,
  });
}
