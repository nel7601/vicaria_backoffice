/**
 * The speech-to-text seam (assistant plan §3, revised).
 *
 * The original plan put recognition on the device to keep audio local. That
 * held up — the spike confirmed on-device recognition works — but it loses on
 * the thing that actually matters clinically: proper nouns. A phone cannot
 * bias its recogniser towards "Cuco Tetilla" or "Priya Sharma" unless it holds
 * the patient list, and it should not hold the patient list.
 *
 * The server does hold it. So recognition moves here, where the vocabulary can
 * be supplied per request, and the seam is shaped like the AI provider one:
 * swapping a public API for a model you host is an address and a key.
 */

export interface TranscriptionRequest {
  audio: Blob;
  /** Filename hint; the format matters to the decoder. */
  filename: string;
  /** BCP-47, e.g. "es" or "en". Improves accuracy when known. */
  language?: "es" | "en";
  /**
   * Names the speaker is likely to say. Biases the decoder towards them,
   * which is the whole reason this runs server-side.
   */
  vocabulary?: string[];
}

export interface TranscriptionResult {
  text: string;
  /** Which implementation produced it, for audit and debugging. */
  provider: string;
  /** Seconds of audio processed, when the provider reports it. */
  durationSeconds?: number;
}

export interface SpeechProvider {
  readonly name: string;
  transcribe(
    request: TranscriptionRequest,
    signal?: AbortSignal,
  ): Promise<TranscriptionResult>;
}

export class SpeechProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SpeechProviderError";
  }
}

/** Refuses everything, so an unconfigured deployment degrades to text input. */
export class UnconfiguredSpeechProvider implements SpeechProvider {
  readonly name = "unconfigured";
  async transcribe(): Promise<TranscriptionResult> {
    throw new SpeechProviderError("No speech provider is configured.", false);
  }
}
