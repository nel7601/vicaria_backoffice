import { NextResponse } from "next/server";
import { requestPrincipal } from "@/lib/assistant/auth/request-identity";
import { assistantFlags } from "@/lib/assistant/flags";
import { assistantError, assistantErrorResponse } from "@/lib/assistant/http";
import { getSpeechProvider } from "@/lib/assistant/speech";
import { SpeechProviderError } from "@/lib/assistant/speech/types";
import { buildVocabulary } from "@/lib/assistant/speech/vocabulary";
import { recordAudit } from "@/lib/audit/record";
import { requireTenant } from "@/lib/auth/principal";
import { CLINIC_TZ } from "@/lib/domain/timezone";
import { InMemoryRateLimiter } from "@/lib/security/rate-limit";

/**
 * POST /api/assistant/v1/transcribe — speech to text, with the clinic's names.
 *
 * The app records audio and posts it here rather than recognising on-device,
 * because the decoder only stands a chance with "Cuco Tetilla" if it is told
 * the name beforehand — and the phone is the wrong place to keep a patient
 * list. The server has one, scoped to the caller.
 *
 * The audio is never written down. It is read from the request, forwarded, and
 * dropped; only the resulting text continues, and only as far as the reply.
 */
export const dynamic = "force-dynamic";

/**
 * A minute of audio takes several seconds to upload and transcribe.
 */
export const maxDuration = 60;

/** Audio is expensive to process, so it is capped harder than a text turn. */
const transcribeLimiter = new InMemoryRateLimiter(30, 60_000);

/** Roughly a minute of compressed speech. Longer is a different feature. */
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const flags = assistantFlags();
  if (!flags.assistantEnabled) {
    return assistantError("assistant_disabled", "The assistant is not enabled", 503);
  }
  if (!flags.voiceEnabled) {
    return assistantError("voice_disabled", "Voice is switched off", 503);
  }

  try {
    const principal = requireTenant(await requestPrincipal(request));

    const decision = transcribeLimiter.check(`stt:${principal.authUserId}`);
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "rate_limited", message: "Too many recordings. Wait a moment." },
        { status: 429 },
      );
    }

    const form = await request.formData().catch(() => null);
    const audio = form?.get("audio");
    if (!(audio instanceof Blob)) {
      return assistantError("invalid_request", "An audio file is required", 400);
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return assistantError("audio_too_large", "That recording is too long", 413);
    }

    const languageField = form?.get("language");
    const language =
      languageField === "es" || languageField === "en" ? languageField : undefined;

    const vocabulary = await buildVocabulary({
      principal,
      now: new Date(),
      timeZone: CLINIC_TZ,
    });

    const provider = getSpeechProvider();
    const result = await provider.transcribe({
      audio,
      filename: (audio as File).name || "speech.m4a",
      language,
      vocabulary,
    });

    // Audit that speech was processed and by whom — never the words. A
    // transcript is what the user said about a patient.
    await recordAudit({
      organizationId: principal.organizationId,
      actorUserId: principal.dbUserId,
      action: "assistant_transcribe",
      entityType: "assistant",
      after: {
        provider: result.provider,
        language: language ?? "auto",
        seconds: result.durationSeconds,
        vocabularyTerms: vocabulary.length,
      },
    });

    return NextResponse.json({
      text: result.text,
      provider: result.provider,
      // The app shows this for the user to correct before sending. Recognition
      // is never trusted enough to act on unread.
      editable: true,
    });
  } catch (error) {
    if (error instanceof SpeechProviderError) {
      return NextResponse.json(
        {
          error: error.retryable ? "speech_unavailable" : "speech_failed",
          message: error.retryable
            ? "Could not transcribe right now. Try again."
            : "Speech recognition is not available.",
        },
        { status: error.retryable ? 503 : 501 },
      );
    }
    return assistantErrorResponse(error);
  }
}
