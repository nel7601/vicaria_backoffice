"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createPatientSchema, type CreatePatientInput } from "@/lib/schemas/patient";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClass } from "@/components/ui/field";
import {
  createPatientAction,
  duplicateCheckAction,
  type DuplicateCheckResult,
} from "../actions";

export function NewPatientForm({ sources }: { sources: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dupes, setDupes] = useState<DuplicateCheckResult["matches"]>([]);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<CreatePatientInput>({
    resolver: zodResolver(createPatientSchema),
    defaultValues: { preferredLanguage: "en", status: "prospect" },
  });

  async function runDuplicateCheck() {
    const v = getValues();
    const res = await duplicateCheckAction({
      email: v.email || undefined,
      phoneE164: v.phoneE164 || undefined,
      legalFirstName: v.legalFirstName || undefined,
      legalLastName: v.legalLastName || undefined,
      dateOfBirth: v.dateOfBirth || undefined,
    });
    setDupes(res.matches);
    setChecked(true);
  }

  function onSubmit(values: CreatePatientInput) {
    setError(null);
    startTransition(async () => {
      const res = await createPatientAction(values);
      if (res.ok && res.patientId) {
        router.push(`/patients/${res.patientId}`);
      } else {
        setError(res.error ?? "Could not create patient.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Legal first name" htmlFor="fn" error={errors.legalFirstName?.message}>
          <Input id="fn" {...register("legalFirstName")} />
        </Field>
        <Field label="Legal last name" htmlFor="ln" error={errors.legalLastName?.message}>
          <Input id="ln" {...register("legalLastName")} />
        </Field>
        <Field label="Preferred name" htmlFor="pn">
          <Input id="pn" {...register("preferredName")} />
        </Field>
        <Field label="Pronouns" htmlFor="pr">
          <Input id="pr" {...register("pronouns")} />
        </Field>
        <Field label="Date of birth" htmlFor="dob" error={errors.dateOfBirth?.message}>
          <Input id="dob" type="date" {...register("dateOfBirth")} />
        </Field>
        <Field label="Preferred language" htmlFor="lang">
          <select id="lang" className={inputClass} {...register("preferredLanguage")}>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </Field>
        <Field label="Email" htmlFor="em" error={errors.email?.message}>
          <Input id="em" type="email" {...register("email")} onBlur={runDuplicateCheck} />
        </Field>
        <Field label="Phone" htmlFor="ph" error={errors.phoneE164?.message}>
          <Input id="ph" {...register("phoneE164")} onBlur={runDuplicateCheck} />
        </Field>
        <Field label="Status" htmlFor="st">
          <select id="st" className={inputClass} {...register("status")}>
            <option value="prospect">Prospect</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
        <Field label="Acquisition source" htmlFor="src">
          <select id="src" className={inputClass} {...register("acquisitionSource")}>
            <option value="">Unknown</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {checked && dupes.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="font-medium text-warning">
            Possible duplicate{dupes.length > 1 ? "s" : ""} found:
          </p>
          <ul className="mt-2 space-y-1">
            {dupes.map((d) => (
              <li key={d.patientId}>
                <Link
                  href={`/patients/${d.patientId}`}
                  className="text-primary hover:underline"
                >
                  {d.name || "Patient"}
                </Link>{" "}
                <span className="text-muted">
                  (matched: {d.reasons.join(", ")})
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            Review before creating a new record. You can still proceed if this is
            a different person.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={runDuplicateCheck}>
          Check for duplicates
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create patient"}
        </Button>
      </div>
    </form>
  );
}
