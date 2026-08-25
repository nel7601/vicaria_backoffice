import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-surface p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-lg font-bold text-primary-foreground">
            V
          </div>
          <div>
            <div className="font-bold" style={{ fontFamily: "var(--font-libre-baskerville), Georgia, serif" }}>Vicaria Health</div>
            <div className="text-xs text-muted">Reset your password</div>
          </div>
        </div>
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
