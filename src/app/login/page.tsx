import Image from "next/image";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
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
          <div className="text-xs text-muted">Backoffice sign in</div>
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
