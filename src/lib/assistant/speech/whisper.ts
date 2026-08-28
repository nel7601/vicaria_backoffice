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
    const model = this.options.model ?? DEFAULT_MODEL;

    const form = new FormData();
    form.append("file", request.audio, request.filename);
    form.append("model", model);
    // Only the original whisper models return verbose_json; the gpt-4o
    // transcribers reject it. Asking for what a model cannot give fails the
    // whole request, so the duration is what gets given up, not the transcript.
    form.append("response_format", supportsVerbose(model) ? "verbose_json" : "json");
    if (request.language) form.append("language", request.language);

    if (request.vocabulary?.length) {
      form.append("prompt", buildPrompt(request.vocabulary, request.language));
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
 * The gpt-4o transcribers are markedly better with proper nouns than
 * whisper-1, which is the failure this whole path exists to fix. Overridable
 * through ASSISTANT_STT_MODEL for a self-hosted deployment, where the model
 * name is whatever that server calls it.
 */
export const DEFAULT_MODEL = "gpt-4o-transcribe";

/** Only the classic whisper models return timings and duration. */
export function supportsVerbose(model: string): boolean {
  return model.startsWith("whisper");
}

/**
 * The prompt is capped (~224 tokens) and truncates silently past it, so the
 * list is bounded here rather than discovered in the results. Send the names
 * most likely to be spoken, not every name on file.
 */
export const MAX_VOCABULARY_TERMS = 60;

/**
 * Build the decoding context.
 *
 * The prompt is not a dictionary — it is an example of what the transcript
 * should look like, and the model imitates its style. A bare comma-separated
 * list of names taught it to write "Ke tengo kon" for "¿Qué tengo con": names
 * came out right and ordinary Spanish fell apart. Wrapping the same names in a
 * correctly written sentence fixed all three test phrases, accents and
 * question marks included.
 *
 * So: well-formed prose, in the language being spoken, with the names inside
 * it.
 */
export function buildPrompt(
  vocabulary: string[],
  language: "es" | "en" = "es",
): string {
  const unique = [...new Set(vocabulary.map((v) => v.trim()).filter(Boolean))];
  if (!unique.length) return "";
  const names = unique.slice(0, MAX_VOCABULARY_TERMS).join(", ");

  // The closing example is doing real work, not decoration. With a long list
  // of names — many of them not Spanish — the instruction alone gets diluted
  // and English words leak into Spanish transcripts ("¿Cuántos patients...").
  // A sample sentence in the target language anchors the style, and it also
  // fixed "¿Qué pacientes" being heard where "¿Cuántos pacientes" was said.
  return language === "en"
    ? `Vicaria clinic consultation. These proper names may be mentioned: ${names}. ` +
        `Transcribe in English, verbatim, with correct spelling and punctuation. ` +
        `Example of the expected style: "How many patients does she have on Friday afternoon?"`
    : `Consulta de la clínica Vicaria. Se mencionan estos nombres propios: ${names}. ` +
        `Transcribe en español de forma literal, con ortografía, tildes y puntuación correctas. ` +
        `Ejemplo del estilo esperado: «¿Cuántos pacientes tiene el viernes por la tarde?»`;
}
