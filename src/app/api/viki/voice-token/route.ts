import { and, eq } from "drizzle-orm";
import {
  AssistantAuthError,
  bearerToken,
  verifyAccessToken,
} from "@/lib/assistant/auth/request-identity";
import { assistantFlags } from "@/lib/assistant/flags";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";

/**
 * POST /api/viki/voice-token — permission to start one voice conversation.
 *
 * This is the door. Viki has no roles and its MCP server answers to a single
 * shared secret, so the only thing standing between a stranger and the clinic
 * is whether they could sign in — and this is where that is checked. The voice
 * platform's key never leaves the server; the phone gets a token good for one
 * conversation and nothing else.
 *
 * The check is deliberately thin and deliberately not nothing: a valid session
 * for an active user of this clinic. No role, no second factor, no scope. That
 * is the app that was asked for, and stating the boundary here is better than
 * leaving it implied across three files.
 */
export const dynamic = "force-dynamic";

export const maxDuration = 20;

export async function POST(request: Request) {
  if (!assistantFlags().assistantEnabled) {
    return Response.json(
      { error: "assistant_disabled", message: "El asistente no está activo" },
      { status: 503 },
    );
  }

  const agentId = setting("AGENT_ID");
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!agentId || !apiKey) {
    return Response.json(
      { error: "not_configured", message: "La voz no está configurada aquí" },
      { status: 503 },
    );
  }

  try {
    const claims = await verifyAccessToken(bearerToken(request));

    const [row] = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.authUserId, claims.authUserId), eq(users.isActive, true)))
      .limit(1);
    if (!row) {
      return Response.json(
        { error: "no_account", message: "Esta cuenta no pertenece a la clínica" },
        { status: 403 },
      );
    }

    const url = new URL("https://api.elevenlabs.io/v1/convai/conversation/token");
    url.searchParams.set("agent_id", agentId);

    const response = await fetch(url, { headers: { "xi-api-key": apiKey } });
    if (!response.ok) {
      // Whatever the voice platform is unhappy about is ours to fix, not the
      // user's to read. Say it plainly and log the status for whoever is.
      console.error(`[viki] token de voz rechazado: ${response.status}`);
      return Response.json(
        { error: "voice_unavailable", message: "No pude abrir la voz. Prueba otra vez." },
        { status: 502 },
      );
    }

    const body = (await response.json()) as { token?: string; conversation_id?: string };
    if (!body.token) {
      return Response.json(
        { error: "voice_unavailable", message: "No pude abrir la voz. Prueba otra vez." },
        { status: 502 },
      );
    }

    return Response.json({ token: body.token, conversationId: body.conversation_id });
  } catch (error) {
    if (error instanceof AssistantAuthError) {
      return Response.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}

/**
 * Read a setting under its current name, falling back to what it used to be
 * called.
 *
 * The app was called Yise while it was being built. Renaming the variables and
 * the deployment cannot happen in the same instant, and whichever goes first
 * would otherwise take the clinic's voice down until the other caught up.
 */
function setting(name: string): string | undefined {
  return (process.env[`VIKI_${name}`] ?? process.env[`YISE_${name}`])?.trim();
}
