import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Verifies Supabase email links (password recovery, invites, email change).
 * The email template points here with token_hash + type; on success the user
 * gets a session cookie and is redirected to `next` (e.g. /reset-password).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/dashboard";

  // Only allow same-origin relative redirects.
  const redirectTo = request.nextUrl.clone();
  redirectTo.pathname = next.startsWith("/") ? next : "/dashboard";
  redirectTo.search = "";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(redirectTo);
    }
  }

  const errorUrl = request.nextUrl.clone();
  errorUrl.pathname = "/login";
  errorUrl.search = "?error=link_expired";
  return NextResponse.redirect(errorUrl);
}
