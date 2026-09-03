"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  updatePatientSchema,
  type UpdatePatientInput,
} from "@/lib/schemas/patient";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClass } from "@/components/ui/field";
import { updatePatientAction } from "../actions";

/**
 * Edit a patient's details in place on their profile.
 *
 * Collapsed by default: the profile is read far more often than it is
 * corrected, and a page that opens in edit mode invites accidental changes to
 * a record several people share.
 */
export function EditPatientForm({
  patientId,
  defaults,
  sources,
}: {
  patientId: string;
  defaults: UpdatePatientInput;
  /** Active acquisition sources from Settings, plus this patient's own. */
  sources: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UpdatePatientInput>({
    resolver: zodResolver(updatePatientSchema),
    defaultValues: defaults,
  });

  function onSubmit(values: UpdatePatientInput) {
    setError(null);
    startTransition(async () => {
      const res = await updatePatientAction(patientId, values);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error ?? "Could not save the patient.");
      }
    });
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Edit details
      </Button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-2xl border border-border p-4"
      noValidate
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Legal first name"
          htmlFor="e-fn"
          error={errors.legalFirstName?.message}
        >
          <Input id="e-fn" {...register("legalFirstName")} />
        </Field>
        <Field
          label="Legal last name"
          htmlFor="e-ln"
          error={errors.legalLastName?.message}
        >
          <Input id="e-ln" {...register("legalLastName")} />
        </Field>
        <Field label="Preferred name" htmlFor="e-pn">
          <Input id="e-pn" {...register("preferredName")} />
        </Field>
        <Field label="Pronouns" htmlFor="e-pr">
          <Input id="e-pr" {...register("pronouns")} />
        </Field>
        <Field
          label="Date of birth"
          htmlFor="e-dob"
          error={errors.dateOfBirth?.message}
        >
          <Input id="e-dob" type="date" {...register("dateOfBirth")} />
        </Field>
        <Field label="Preferred language" htmlFor="e-lang">
          <select
            id="e-lang"
            className={inputClass}
            {...register("preferredLanguage")}
          >
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </Field>
        <Field label="Email" htmlFor="e-em" error={errors.email?.message}>
          <Input id="e-em" type="email" {...register("email")} />
        </Field>
        <Field label="Phone" htmlFor="e-ph" error={errors.phoneE164?.message}>
          <Input id="e-ph" {...register("phoneE164")} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Address" htmlFor="e-addr" error={errors.address?.message}>
            <textarea
              id="e-addr"
              className={`${inputClass} min-h-16`}
              {...register("address")}
            />
          </Field>
        </div>
        <Field label="Emergency contact name" htmlFor="e-ecn">
          <Input id="e-ecn" {...register("emergencyContactName")} />
        </Field>
        <Field
          label="Emergency contact phone"
          htmlFor="e-ecp"
          error={errors.emergencyContactPhone?.message}
        >
          <Input id="e-ecp" {...register("emergencyContactPhone")} />
        </Field>
        <Field label="Status" htmlFor="e-st">
          <select id="e-st" className={inputClass} {...register("status")}>
            <option value="prospect">Prospect</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="blocked">Blocked</option>
            <option value="deceased">Deceased</option>
          </select>
        </Field>
        <Field label="Acquisition source" htmlFor="e-src">
          <select id="e-src" className={inputClass} {...register("acquisitionSource")}>
            <option value="">Unknown</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 pt-6 text-sm">
          <input type="checkbox" {...register("marketingOptIn")} />
          Marketing opt-in
        </label>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            reset(defaults);
            setError(null);
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
