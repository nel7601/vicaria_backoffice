/**
 * POST /api/viki/postcall — where Viki's conversations go to be forgotten.
 *
 * The voice platform sends a full transcript at the end of every conversation,
 * to whichever webhook the agent points at. The workspace default sends it to
 * another system entirely, which then texts a summary to a list of phones —
 * fine for the sales agents it was built for, wrong for a clinic, where the
 * transcript carries patient names, appointment times and amounts.
 *
 * The agent cannot decline to send it, so it sends it here instead, and here
 * it stops. The body is read and dropped: nothing stored, nothing forwarded,
 * nothing logged beyond the fact that a conversation ended.
 *
 * The alternative was to point the agent at nothing, but a webhook that fails
 * gets retried and eventually auto-disabled, and an auto-disabled webhook on
 * an agent is one release away from silently falling back to the workspace
 * default. A 200 that discards is quieter and more stable than an error.
 */
export const dynamic = "force-dynamic";

export const maxDuration = 15;

export async function POST(request: Request) {
  // Read it so the connection closes cleanly, then let it go out of scope.
  // Never parsed into anything that could end up in a log line.
  await request.text().catch(() => "");

  // Deliberately without the conversation id: identifiers are the thread you
  // pull to find the transcript somewhere else, and there is no somewhere
  // else worth keeping here.
  console.log("[viki] conversación terminada; transcripción descartada");

  return new Response(null, { status: 204 });
}
