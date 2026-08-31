import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/auth",
  "/api/webhooks",
  "/forgot-password",
  // Personal calendar feeds: the secret URL is the credential, and the
  // subscriber is a calendar client that cannot sign in or follow a redirect.
  "/api/calendar",
  "/reset-password",
  // Bearer-authenticated API for the assistant APK: it authenticates itself
  // per request and must answer 401 JSON, never a 302 to the login page which
  // a mobile client cannot act on.
  "/api/assistant",
  // Same for the MCP server. A redirect here would reach ChatGPT or Claude as
  // an HTML page where a protocol handshake was expected, and the connector
  // would report something unhelpful instead of "you need to sign in".
  "/api/mcp",
  // Viki's two endpoints, for the same reason twice over: one is a bearer
  // token from the phone, the other a shared secret from the voice platform,
  // and neither caller can do anything with a redirect to a login page.
  "/api/viki",
  // The metadata document the 401 challenge points at. Redirecting it to
  // /login would make the challenge a dead end: the client is told it needs
  // authorization and then handed an HTML page instead of where to get it.
  "/.well-known/",
];

/**
 * Refreshes the Supabase session on every request and gates private routes.
 * Session expiry / revocation on user deactivation is enforced here plus in
 * RLS (spec FR-AUTH-003).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectedFrom", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
