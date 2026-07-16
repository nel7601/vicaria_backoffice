import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { MfaSetup } from "./mfa-setup";

export default async function MfaPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Already satisfied (or not required): nothing to do here.
  if (!user.mfaRequired || user.mfaSatisfied) redirect("/dashboard");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-border bg-surface p-8 shadow-sm">
        <div>
          <h1 className="text-lg font-semibold">Two-factor authentication</h1>
          <p className="mt-1 text-sm text-muted">
            Your role ({user.roles.join(", ")}) requires MFA. Set up or verify an
            authenticator app to continue.
          </p>
        </div>
        <MfaSetup />
      </div>
    </div>
  );
}
