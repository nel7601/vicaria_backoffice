"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { createEncounterAction } from "./actions";

interface Option {
  id: string;
  label: string;
}

interface FormValues {
  patientId: string;
  templateVersionId: string;
  modality: "in_person" | "virtual" | "phone";
}

export function NewEncounterForm({
  patients,
  templates,
}: {
  patients: Option[];
  templates: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const { register, handleSubmit } = useForm<FormValues>({
    defaultValues: { modality: "in_person" },
  });

  function onSubmit(v: FormValues) {
    setError(null);
    startTransition(async () => {
      const res = await createEncounterAction({
        patientId: v.patientId,
        practitionerId: v.patientId, // ignored server-side; set from session
        templateVersionId: v.templateVersionId || undefined,
        modality: v.modality,
      });
      if (res.ok && res.encounterId) {
        router.push(`/encounters/${res.encounterId}`);
      } else {
        setError(res.error ?? "Could not create encounter.");
      }
    });
  }

  if (!open) return <Button onClick={() => setOpen(true)}>New encounter</Button>;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="grid grid-cols-1 gap-3 rounded-md border border-border p-4 sm:grid-cols-3"
    >
      <Field label="Patient" htmlFor="en-patient">
        <select id="en-patient" className={inputClass} required {...register("patientId")}>
          <option value="">Select…</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Template" htmlFor="en-tpl">
        <select id="en-tpl" className={inputClass} {...register("templateVersionId")}>
          <option value="">None</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Modality" htmlFor="en-mod">
        <select id="en-mod" className={inputClass} {...register("modality")}>
          <option value="in_person">In person</option>
          <option value="virtual">Virtual</option>
          <option value="phone">Phone</option>
        </select>
      </Field>
      {error && <p className="text-sm text-danger sm:col-span-3">{error}</p>}
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Start encounter"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
