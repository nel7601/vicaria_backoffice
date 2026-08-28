import {
  SpeechProviderError,
  type SpeechProvider,
  type TranscriptionRequest,
  type TranscriptionResult,
} from "./types";

/**
 * Whisper over the OpenAI-compatible transcription contract.
 *
 * Written against the wire format rather than a vendor SDK on purpose: the
 * same request works against OpenAI today and against faster-whisper,
 * whisper.cpp's server or vLLM on your own hardware tomorrow. Only the base
 * URL and the key change.
 */
export class WhisperProvider implements SpeechProvider {
  readonly name: string;

  constructor(
    private readonly options: {
      baseURL: string;
      apiKey: string;
      model?: string;
      /** Distinguishes a self-hosted deployment in logs and audit. */
      label?: string;
    },
  ) {
    this.name = options.label ?? "whisper";
  }

  async transcribe(
    request: TranscriptionRequest,
    signal?: AbortSignal,
  ): Promise<TranscriptionResult> {
    const form = new FormData();
    form.append("file", request.audio, request.filename);
    form.append("model", this.options.model ?? "whisper-1");
    form.append("response_format", "verbose_json");
    if (request.language) form.append("language", request.language);

    // Whisper takes a free-text prompt as decoding context rather than a word
    // list. Names separated by commas is the shape that biases it without
    // making it try to continue a sentence.
    if (request.vocabulary?.length) {
      form.append("prompt", buildPrompt(request.vocabulary));
    }

    let response: Response;
    try {
      response = await fetch(
        `${this.options.baseURL.replace(/\/$/, "")}/audio/transcriptions`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${this.options.apiKey}` },
          body: form,
          signal,
        },
      );
    } catch {
      throw new SpeechProviderError("Could not reach the speech service.", true);
    }

    if (!response.ok) {
      // 5xx and 429 are worth retrying; a 4xx means the request was wrong.
      const retryable = response.status >= 500 || response.status === 429;
      throw new SpeechProviderError(
        `Speech service returned ${response.status}.`,
        retryable,
      );
    }

    const body = (await response.json()) as {
      text?: string;
      duration?: number;
    };

    if (typeof body.text !== "string") {
      throw new SpeechProviderError("Speech service returned no text.", false);
    }

    return {
      text: body.text.trim(),
      provider: this.name,
      durationSeconds: body.duration,
    };
  }
}

/**
 * Whisper's prompt is capped (~224 tokens) and silently truncates beyond it,
 * so the list is bounded here rather than discovering the cut-off in the
 * results. Callers should send the names most likely to be spoken, not every
 * name they have.
 */
export const MAX_VOCABULARY_TERMS = 60;

export function buildPrompt(vocabulary: string[]): string {
  const unique = [...new Set(vocabulary.map((v) => v.trim()).filter(Boolean))];
  return unique.slice(0, MAX_VOCABULARY_TERMS).join(", ");
}
