"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

type Phase = "loading" | "enroll" | "verify" | "error";

/**
 * TOTP enrollment + verification (FR-AUTH-002). On success the session is
 * elevated to aal2 and the user is routed into the app.
 */
export function MfaSetup() {
  const router = useRouter();
  const supabase = createClient();

  const [phase, setPhase] = useState<Phase>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      // If a verified factor already exists, go straight to a challenge.
      const { data: factors, error } = await supabase.auth.mfa.listFactors();
      if (!active) return;
      if (error) {
        setMessage(error.message);
        setPhase("error");
        return;
      }
      const verified = factors?.totp?.find((f) => f.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        setPhase("verify");
        return;
      }
      // Otherwise enroll a fresh TOTP factor.
      const { data: enroll, error: enrollErr } =
        await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (!active) return;
      if (enrollErr || !enroll) {
        setMessage(enrollErr?.message ?? "Could not start enrollment.");
        setPhase("error");
        return;
      }
      setFactorId(enroll.id);
      setQr(enroll.totp.qr_code);
      setSecret(enroll.totp.secret);
      setPhase("enroll");
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitCode() {
    if (!factorId) return;
    setSubmitting(true);
    setMessage(null);
    const { data: challenge, error: challengeErr } =
      await supabase.auth.mfa.challenge({ factorId });
    if (challengeErr || !challenge) {
      setMessage(challengeErr?.message ?? "Challenge failed.");
      setSubmitting(false);
      return;
    }
    const { error: verifyErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    if (verifyErr) {
      setMessage(verifyErr.message);
      setSubmitting(false);
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  if (phase === "loading") {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  if (phase === "error") {
    return (
      <p role="alert" className="text-sm text-danger">
        {message ?? "Something went wrong."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {phase === "enroll" && (
        <div className="space-y-3">
          <p className="text-sm">
            Scan this QR code with your authenticator app, then enter the
            6-digit code.
          </p>
          {qr && (
            // Supabase returns an inline SVG data URI; safe to render as image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qr}
              alt="TOTP QR code"
              className="mx-auto h-44 w-44 rounded-md border border-border bg-white p-2"
            />
          )}
          {secret && (
            <p className="break-all text-center text-xs text-muted">
              Manual key: <code>{secret}</code>
            </p>
          )}
        </div>
      )}

      {phase === "verify" && (
        <p className="text-sm">
          Enter the current 6-digit code from your authenticator app.
        </p>
      )}

      <div className="space-y-1">
        <label htmlFor="mfa-code" className="text-sm font-medium">
          Verification code
        </label>
        <input
          id="mfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm tracking-widest"
          placeholder="123456"
        />
      </div>

      {message && (
        <p role="alert" className="text-sm text-danger">
          {message}
        </p>
      )}

      <Button
        onClick={submitCode}
        disabled={submitting || code.trim().length < 6}
        className="w-full"
      >
        {submitting ? "Verifying…" : "Verify and continue"}
      </Button>
    </div>
  );
}
