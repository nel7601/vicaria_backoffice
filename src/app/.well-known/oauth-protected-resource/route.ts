import { protectedResourceHandler } from "mcp-handler";

/**
 * RFC 9728 Protected Resource Metadata.
 *
 * When the MCP endpoint answers 401 it points here, and this is where a client
 * learns which authorization server can issue it a token. Without it the
 * challenge is a dead end: the client is told it needs authorization and given
 * nowhere to get it.
 *
 * The authorization server is the Supabase project that already issues the
 * tokens every other route accepts, so a client that obtains one is
 * authorised exactly like the mobile app.
 */
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

const handler = protectedResourceHandler({
  authServerUrls: supabaseUrl ? [`${supabaseUrl}/auth/v1`] : [],
});

export { handler as GET };
