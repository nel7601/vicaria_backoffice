"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

const schema = z
  .object({
    password: z.string().min(10, "Use at least 10 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

type FormValues = z.infer<typeof schema>;

export function ResetPasswordForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({
      password: values.password,
    });
    if (error) {
      setServerError(
        error.message.includes("session")
          ? "Your reset link has expired. Request a new one from the sign-in page."
          : error.message,
      );
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1">
        <label htmlFor="password" className="text-sm font-medium">
          New password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          {...register("password")}
          className={inputClass}
        />
        {errors.password && (
          <p className="text-xs text-danger">{errors.password.message}</p>
        )}
      </div>
      <div className="space-y-1">
        <label htmlFor="confirm" className="text-sm font-medium">
          Confirm new password
        </label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          {...register("confirm")}
          className={inputClass}
        />
        {errors.confirm && (
          <p className="text-xs text-danger">{errors.confirm.message}</p>
        )}
      </div>
      {serverError && (
        <p role="alert" className="text-sm text-danger">
          {serverError}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
