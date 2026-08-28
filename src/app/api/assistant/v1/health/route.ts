import { NextResponse } from "next/server";
import {
  ASSISTANT_API_VERSION,
  MINIMUM_APP_VERSION,
  assistantFlags,
} from "@/lib/assistant/flags";

/**
 * GET /api/assistant/v1/health — compatibility probe (§4.2 of the plan).
 *
 * Deliberately unauthenticated: the APK calls it before login to learn whether
 * it must force an update and whether the assistant is switched on at all.
 * It therefore exposes only non-sensitive flags — no tenant, no user, no
 * counts, nothing that varies per organization.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const flags = assistantFlags();

  return NextResponse.json({
    status: "ok",
    apiVersion: ASSISTANT_API_VERSION,
    minimumAppVersion: MINIMUM_APP_VERSION,
    features: {
      assistant: flags.assistantEnabled,
      voice: flags.voiceEnabled,
      writeActions: flags.writeActionsEnabled,
      reschedule: flags.rescheduleEnabled,
    },
  });
}
