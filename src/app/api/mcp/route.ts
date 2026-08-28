import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { requestPrincipal } from "@/lib/assistant/auth/request-identity";
import { assistantFlags } from "@/lib/assistant/flags";
import { invokeTool, toolsFor } from "@/lib/assistant/tools/registry";
import type { Principal } from "@/lib/auth/principal";
import { requireTenant } from "@/lib/auth/principal";
import { CLINIC_TZ } from "@/lib/domain/timezone";

/**
 * The clinic as an MCP server.
 *
 * The same closed catalogue the assistant uses, offered over a protocol that
 * ChatGPT, Claude and others speak natively. That changes who can ask: instead
 * of an app we have to build and maintain, the question can come from a client
 * that already exists — with voice, history and streaming already solved.
 *
 * Nothing about the security model changes. Tools are still filtered by role
 * before being offered and re-checked before running, reads still write their
 * access log, and writes still refuse without a confirmed proposal. A protocol
 * decides who may call; it does not decide what they may see.
 */
export const dynamic = "force-dynamic";

/**
 * Long enough for a tool that queries and a model that waits on it, without
 * inheriting the 10s default that would cut the interesting ones short.
 */
export const maxDuration = 60;

type TenantPrincipal = Principal & { organizationId: string; dbUserId: string };

/**
 * Verify the Supabase bearer token and carry the principal forward.
 *
 * Same identity as every other route: the token is checked against Supabase,
 * the tenant is resolved server-side, and nothing the client sends is trusted
 * as authority. Returning undefined makes the adapter answer 401 with the
 * RFC 9728 challenge clients expect.
 */
async function verifyToken(
  request: Request,
  bearer?: string,
): Promise<AuthInfo | undefined> {
  if (!bearer) return undefined;
  try {
    const principal = requireTenant(await requestPrincipal(request));
    return {
      token: bearer,
      clientId: "vicaria-mcp",
      // Roles double as scopes, so a client can see what it was granted.
      scopes: principal.roles,
      extra: { principal },
    };
  } catch {
    return undefined;
  }
}

const handler = async (request: Request): Promise<Response> => {
  if (!assistantFlags().assistantEnabled) {
    return Response.json(
      { error: "assistant_disabled", message: "The assistant is not enabled" },
      { status: 503 },
    );
  }

  const principal = request.auth?.extra?.principal as TenantPrincipal | undefined;
  if (!principal) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Built per request so the catalogue reflects this caller's roles. A tool a
  // role cannot use is not described to it at all — the same rule the
  // orchestrator follows, for the same reason: the cheapest way to stop a
  // model asking for something is not to mention it.
  const mcp = createMcpHandler(
    (server) => {
      // The SDK infers argument types per tool from its schema, which needs the
      // schema known at compile time. This catalogue is built at runtime from
      // heterogeneous tools, so that inference cannot apply and the cast is
      // narrowed to this one call. The Zod schema still validates at runtime —
      // the SDK speaks Standard Schema, so the tool's own declaration is what
      // clients are shown and what incoming arguments are checked against.
      const register = server.registerTool.bind(server) as unknown as (
        name: string,
        config: { title: string; description: string; inputSchema: unknown },
        cb: (
          args: unknown,
        ) => Promise<{ content: { type: "text"; text: string }[] }>,
      ) => unknown;

      for (const tool of toolsFor(principal)) {
        register(
          tool.name,
          {
            title: tool.name,
            description: tool.description,
            inputSchema: tool.input,
          },
          async (args: unknown) => {
            // invokeTool re-checks the permission and validates the arguments;
            // being offered a tool is not permission to run it.
            const result = await invokeTool(tool.name, args, {
              principal,
              now: new Date(),
              timeZone: CLINIC_TZ,
              channel: "text",
            });
            return {
              content: [{ type: "text" as const, text: JSON.stringify(result) }],
            };
          },
        );
      }
    },
    {
      serverInfo: { name: "vicaria-backoffice", version: "1.0.0" },
      instructions:
        "Tools for the Vicaria clinic backoffice: appointments, patients, home care, " +
        "billing and reports. Every answer about the clinic must come from these tools — " +
        "never from memory. Dates are resolved with resolve_date in the clinic's timezone; " +
        "do not compute them yourself. When a name or date is ambiguous, ask rather than assume.",
    },
  );

  return mcp(request);
};

const authed = withMcpAuth(handler, verifyToken, { required: true });

export { authed as GET, authed as POST, authed as DELETE };
