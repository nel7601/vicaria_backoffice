"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ResetPasswordForm } from "./reset-password-form";

/**
 * Decides whether this visitor may set a password.
 *
 * The server can answer that on its own only when the session is already in
 * cookies. Supabase also returns invitation and recovery sessions in the URL
 * fragment (`#access_token=…`), which is never sent to a server — so when the
 * server saw nothing, the browser gets its turn: creating the client consumes
 * whatever the link carried, and we wait briefly for the session to appear
 * before calling the link expired.
 */
export function ResetGate({ hasServerSession }: { hasServerSession: boolean }) {
  const [state, setState] = useState<"checking" | "ready" | "expired">(
    hasServerSession ? "ready" : "checking",
  );

  useEffect(() => {
    if (hasServerSession) return;
    const supabase = createClient();
    let done = false;

    const settle = (ok: boolean) => {
      if (done) return;
      done = true;
      setState(ok ? "ready" : "expired");
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) settle(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) settle(true);
    });
    // The link is only expired once we have given the browser time to redeem it.
    const timer = setTimeout(() => settle(false), 3000);

    return () => {
      done = true;
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, [hasServerSession]);

  if (state === "checking") {
    return <p className="text-sm text-muted">Checking your link…</p>;
  }
  if (state === "ready") return <ResetPasswordForm />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-danger">
        This link is invalid or has expired.
      </p>
      <Link
        href="/forgot-password"
        className="text-sm text-primary hover:underline"
      >
        Request a new link
      </Link>
    </div>
  );
}
