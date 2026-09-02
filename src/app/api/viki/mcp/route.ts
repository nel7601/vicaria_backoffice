import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import { executeProposal } from "@/lib/assistant/actions/execute";
import { cancelProposal } from "@/lib/assistant/actions/proposals";
import { assistantFlags } from "@/lib/assistant/flags";
import { invokeTool, toolsFor } from "@/lib/assistant/tools/registry";
import { CLINIC_TZ } from "@/lib/domain/timezone";
import { vikiPrincipal, VikiIdentityError } from "@/lib/viki/identity";

/**
 * The clinic as an MCP server for Viki — the same catalogue, no roles.
 *
 * Separate from `/api/mcp` on purpose, and the difference is the whole point:
 * that one resolves a person from their own session and shows them only what
 * their role allows; this one has a single identity, a single shared secret,
 * and shows everything. It exists because the voice platform holding the
 * conversation stores server credentials per agent, not per caller, so there
 * is no per-user token to carry even if we wanted one.
 *
 * What follows from that is worth being plain about rather than discovering
 * later: anyone who can reach this URL with the token sees the whole clinic.
 * The token is the only thing between the two facts. It belongs in the voice
 * platform's secret store and nowhere else — not in the app, which never
 * calls this, and not in a repository.
 */
export const dynamic = "force-dynamic";

/** A tool that queries plus a model that waits on it, without the 10s default. */
export const maxDuration = 60;

/**
 * Constant-time comparison, so a wrong token takes as long as a right one.
 *
 * A plain `===` leaks the length of the matching prefix through timing, which
 * is enough to recover a secret one character at a time given patience.
 */
function tokenMatches(offered: string, expected: string): boolean {
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, value] = header.split(" ");
  if (!value || scheme.toLowerCase() !== "bearer") return null;
  return value.trim();
}

const proposalArgs = { proposalId: z.uuid() };

export const POST = async (request: Request): Promise<Response> => {
  const flags = assistantFlags();
  if (!flags.assistantEnabled) {
    return Response.json(
      { error: "assistant_disabled", message: "The assistant is not enabled" },
      { status: 503 },
    );
  }

  // Trimmed because this value is pasted into a web form at the other end,
  // and a trailing newline there would fail every request with a message
  // saying the token was wrong — which it would be, by one invisible byte.
  const expected = setting("MCP_TOKEN");
  if (!expected) {
    // Missing configuration must close the door, not open it. Without this a
    // deployment that forgot the variable would be a clinic with no lock.
    return Response.json(
      { error: "not_configured", message: "Viki is not configured here" },
      { status: 503 },
    );
  }

  const offered = bearer(request);
  if (!offered || !tokenMatches(offered, expected)) {
    return Response.json(
      { error: "invalid_token", message: "A valid bearer token is required" },
      { status: 401 },
    );
  }

  let principal: Awaited<ReturnType<typeof vikiPrincipal>>;
  try {
    principal = await vikiPrincipal();
  } catch (error) {
    if (error instanceof VikiIdentityError) {
      return Response.json(
        { error: "not_configured", message: error.message },
        { status: 503 },
      );
    }
    throw error;
  }

  const mcp = createMcpHandler(
    (server) => {
      // The SDK infers argument types per tool from a compile-time schema; this
      // catalogue is assembled at runtime, so the cast is confined here. Zod
      // still validates every call.
      const register = server.registerTool.bind(server) as unknown as (
        name: string,
        config: { title: string; description: string; inputSchema: unknown },
        cb: (args: never) => Promise<{ content: { type: "text"; text: string }[] }>,
      ) => unknown;

      const said = (value: unknown) => ({
        content: [{ type: "text" as const, text: JSON.stringify(value) }],
      });

      for (const tool of toolsFor(principal)) {
        register(
          tool.name,
          { title: tool.name, description: tool.description, inputSchema: tool.input },
          async (args: never) =>
            said(
              await invokeTool(tool.name, args, {
                principal,
                now: new Date(),
                timeZone: CLINIC_TZ,
                // Answers are going to be spoken, so they should be written to
                // be heard: short, no lists read out loud, no identifiers.
                channel: "voice",
              }),
            ),
        );
      }

      if (!flags.writeActionsEnabled) return;

      // The propose tools hand back an id and stop. In Viki that id reaches a
      // card with two buttons; in a voice conversation there is no card, so
      // without these two the writes are visible and unreachable — the model
      // describes a change it can never make.
      //
      // Confirming by voice is a real loosening and not a technicality: "sí"
      // in the middle of a sentence is now capable of moving an appointment.
      // The proposal's own protections still hold — it expires, it is spent
      // once, and its arguments were resolved when it was described — but the
      // finger on a button is gone, and that was the strongest of them.
      register(
        "confirm_action",
        {
          title: "confirm_action",
          description:
            "Carry out a change that was proposed earlier in this conversation. Pass the " +
            "proposalId the propose tool returned. Read the summary back to the user and " +
            "get a clear yes for THIS change before calling it — never assume, and never " +
            "confirm something the user did not hear you describe.",
          inputSchema: proposalArgs,
        },
        async (args: never) => {
          const { proposalId } = args as { proposalId: string };
          const outcome = await executeProposal(principal, proposalId, new Date());
          return said(
            outcome.ok
              ? { done: true, message: outcome.message, result: outcome.result }
              : { done: false, reason: outcome.reason },
          );
        },
      );

      register(
        "cancel_action",
        {
          title: "cancel_action",
          description:
            "Discard a proposed change the user turned down. Cheap and always safe: an " +
            "abandoned proposal expires by itself, but saying so keeps the record honest.",
          inputSchema: proposalArgs,
        },
        async (args: never) => {
          const { proposalId } = args as { proposalId: string };
          const outcome = await cancelProposal(principal, proposalId);
          return said(outcome);
        },
      );
    },
    {
      serverInfo: { name: "vicaria-viki", version: "1.0.0" },
      instructions:
        "Tools for the Vicaria clinic backoffice: appointments, patients, home care, " +
        "billing and reports. Every statement about the clinic must come from these tools, " +
        "never from memory. Resolve dates with resolve_date in the clinic's timezone rather " +
        "than computing them. When a name or a date could mean more than one thing, ask. " +
        "To change anything, call the matching tool to propose it, read the summary back " +
        "aloud, wait for a clear yes, and only then call confirm_action.",
    },
  );

  return mcp(request);
};

export { POST as GET, POST as DELETE };

/**
 * Read one of Viki's settings from the environment.
 *
 * A helper rather than `process.env.VIKI_X` at each site so the prefix is
 * declared once, and trimmed because these are pasted into a web form at the
 * other end — a trailing newline there would fail every request with a message
 * saying the token is wrong, which is true by one invisible byte and useless
 * to act on.
 */
function setting(name: string): string | undefined {
  return process.env[`VIKI_${name}`]?.trim();
}
