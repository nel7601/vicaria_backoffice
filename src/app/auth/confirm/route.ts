import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Verifies Supabase email links — password recovery, invitations, email
 * change — and establishes the session the destination page needs.
 *
 * Supabase hands these back in more than one shape depending on how the
 * project's templates and flow are configured, and an invitation that lands
 * in the wrong branch looks to the employee like an expired link:
 *
 *   token_hash + type  a custom template pointing straight here
 *   code               the PKCE flow, after Supabase verified the token itself
 *   neither            Supabase already established the session, or the tokens
 *                      are in the URL fragment, which never reaches a server
 *
 * The last case is why an absent token is not treated as failure: the browser
 * completes it (see the reset page's gate). Only a link that verifies *and*
 * leaves no session is genuinely expired.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  // Only allow same-origin relative redirects.
  const redirectTo = request.nextUrl.clone();
  redirectTo.pathname = next.startsWith("/") ? next : "/dashboard";
  redirectTo.search = "";

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(redirectTo);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(redirectTo);
  } else {
    // Nothing to verify: let the destination decide, so a fragment-carried
    // session still gets its chance in the browser.
    return NextResponse.redirect(redirectTo);
  }

  const errorUrl = request.nextUrl.clone();
  errorUrl.pathname = "/login";
  errorUrl.search = "?error=link_expired";
  return NextResponse.redirect(errorUrl);
}
