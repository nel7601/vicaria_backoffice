import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { ResetGate } from "./reset-gate";

/**
 * Set a new password. Reached from a recovery or invitation email after
 * /auth/confirm has redeemed the token; when the session arrives in the URL
 * fragment instead, the gate finishes the job in the browser.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-surface p-8 shadow-sm">
        <div className="space-y-2">
          <Image
            src="/brand/vicaria-logo.png"
            alt="Vicaria Health Coaching"
            width={1600}
            height={509}
            className="h-auto w-full max-w-[260px]"
            priority
          />
          <div className="text-xs text-muted">Choose a new password</div>
        </div>
        <ResetGate hasServerSession={Boolean(user)} />
      </div>
    </div>
  );
}
