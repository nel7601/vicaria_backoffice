import Image from "next/image";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-surface p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <Image
            src="/brand/vicaria-symbol.png"
            alt="Vicaria Health"
            width={38}
            height={50}
            className="h-12 w-auto"
            priority
          />
          <div>
            <div className="font-bold" style={{ fontFamily: "var(--font-libre-baskerville), Georgia, serif" }}>Vicaria Health</div>
            <div className="text-xs text-muted">Backoffice sign in</div>
          </div>
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
        <p className="text-center text-xs text-muted">
          Privileged roles require MFA (FR-AUTH-002).
        </p>
      </div>
    </div>
  );
}
