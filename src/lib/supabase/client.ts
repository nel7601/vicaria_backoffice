import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client. Uses the anon key, which is safe to expose because
 * every table is protected by RLS (spec §14.3). Never use the service role key
 * on the client.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
