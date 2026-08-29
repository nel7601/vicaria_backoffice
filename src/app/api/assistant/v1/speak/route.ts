import { z } from "zod";
import { requestPrincipal } from "@/lib/assistant/auth/request-identity";
import { assistantFlags } from "@/lib/assistant/flags";
import { assistantError, assistantErrorResponse } from "@/lib/assistant/http";
import { SpeechProviderError } from "@/lib/assistant/speech/types";
import { VOICES, getTtsProvider } from "@/lib/assistant/speech/tts";
import { requireTenant } from "@/lib/auth/principal";
import { checkRateLimit } from "@/lib/security/durable-rate-limit";

/**
 * POST /api/assistant/v1/speak — Viki's voice.
 *
 * Takes the sentence to say and returns audio. Nothing is stored: the text
 * arrives, the audio is streamed back, and neither is written down — the words
 * are about patients even when the names are left out.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const bodySchema = z.object({
  /** Short by design: this is the spoken form, not the screen text. */
  text: z.string().trim().min(1).max(1200),
  voice: z.enum(VOICES).optional(),
  language: z.enum(["es", "en"]).default("es"),
  speed: z.number().min(0.5).max(2).optional(),
});

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

    const decision = await checkRateLimit(`tts:${principal.authUserId}`, 60, 60);
    if (!decision.allowed) {
      return assistantError("rate_limited", "Too many requests. Wait a moment.", 429);
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return assistantError("invalid_request", "Text to speak is required", 400);
    }

    const audio = await getTtsProvider().speak(parsed.data);

    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        // Nothing about a patient should sit in an intermediate cache.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof SpeechProviderError) {
      return assistantError(
        error.retryable ? "speech_unavailable" : "speech_failed",
        error.retryable ? "Could not speak right now." : "Speech synthesis is not available.",
        error.retryable ? 503 : 501,
      );
    }
    return assistantErrorResponse(error);
  }
}
