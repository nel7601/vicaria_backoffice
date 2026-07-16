import { createClient } from "@supabase/supabase-js";

/**
 * Service-role admin client (server only, spec §14.3).
 *
 * Bypasses RLS — use ONLY in trusted server code after an explicit
 * authorization check (src/lib/auth/authorize.ts). Never import from the
 * client. Used for privileged operations such as inviting employees and
 * setting their role claims.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
