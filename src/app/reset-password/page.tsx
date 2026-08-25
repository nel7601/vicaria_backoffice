import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";

/**
 * Set a new password. Reached from the recovery-email link after
 * /auth/confirm verified the token and established a session.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-surface p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-lg font-bold text-primary-foreground">
            V
          </div>
          <div>
            <div className="font-semibold">Vicaria Health</div>
            <div className="text-xs text-muted">Choose a new password</div>
          </div>
        </div>
        {user ? (
          <ResetPasswordForm />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-danger">
              This reset link is invalid or has expired.
            </p>
            <Link
              href="/forgot-password"
              className="text-sm text-primary hover:underline"
            >
              Request a new reset link →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
