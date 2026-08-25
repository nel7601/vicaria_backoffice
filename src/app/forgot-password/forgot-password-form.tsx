"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
});

type FormValues = z.infer<typeof schema>;

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
    });
    if (error) {
      setServerError(error.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <p className="text-sm">
          If an account exists for that email, a password reset link is on its
          way. Check your inbox (and spam folder).
        </p>
        <Link href="/login" className="text-sm text-primary hover:underline">
          ← Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          {...register("email")}
          className={inputClass}
        />
        {errors.email && (
          <p className="text-xs text-danger">{errors.email.message}</p>
        )}
      </div>
      {serverError && (
        <p role="alert" className="text-sm text-danger">
          {serverError}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Sending…" : "Send reset link"}
      </Button>
      <p className="text-center">
        <Link href="/login" className="text-sm text-muted hover:underline">
          ← Back to sign in
        </Link>
      </p>
    </form>
  );
}
