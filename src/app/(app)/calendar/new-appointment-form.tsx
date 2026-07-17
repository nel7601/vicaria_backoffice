"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClass } from "@/components/ui/field";
import { createAppointmentAction } from "./actions";

interface Option {
  id: string;
  label: string;
}

interface FormValues {
  patientId: string;
  employeeId: string;
  serviceId: string;
  startAt: string;
  durationMinutes: number;
  modality: "in_person" | "virtual" | "phone";
  notesAdmin: string;
}

export function NewAppointmentForm({
  patients,
  employees,
  services,
}: {
  patients: Option[];
  employees: Option[];
  services: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const { register, handleSubmit, reset } = useForm<FormValues>({
    defaultValues: { modality: "in_person", durationMinutes: 60 },
  });

  function onSubmit(v: FormValues) {
    setMessage(null);
    const start = new Date(v.startAt);
    const end = new Date(start.getTime() + Number(v.durationMinutes) * 60_000);
    startTransition(async () => {
      const res = await createAppointmentAction({
        patientId: v.patientId,
        employeeId: v.employeeId,
        serviceId: v.serviceId || undefined,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        modality: v.modality,
        estimatedPriceCents: 0,
        notesAdmin: v.notesAdmin || undefined,
      });
      if (res.ok) {
        reset();
        setOpen(false);
        setMessage(null);
        // Jump the agenda to the appointment's day (clinic timezone) so the
        // new appointment is immediately visible.
        const dayStr = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Toronto",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(start);
        router.push(`/calendar?date=${dayStr}`);
        router.refresh();
      } else {
        setMessage(res.error ?? "Could not create appointment.");
      }
    });
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>New appointment</Button>;
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="grid grid-cols-1 gap-3 rounded-md border border-border p-4 sm:grid-cols-2"
    >
      <Field label="Patient" htmlFor="ap-patient">
        <select id="ap-patient" className={inputClass} required {...register("patientId")}>
          <option value="">Select…</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Practitioner" htmlFor="ap-emp">
        <select id="ap-emp" className={inputClass} required {...register("employeeId")}>
          <option value="">Select…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Service" htmlFor="ap-svc">
        <select id="ap-svc" className={inputClass} {...register("serviceId")}>
          <option value="">None</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Modality" htmlFor="ap-mod">
        <select id="ap-mod" className={inputClass} {...register("modality")}>
          <option value="in_person">In person</option>
          <option value="virtual">Virtual</option>
          <option value="phone">Phone</option>
        </select>
      </Field>
      <Field label="Start" htmlFor="ap-start">
        <Input id="ap-start" type="datetime-local" required {...register("startAt")} />
      </Field>
      <Field label="Duration (min)" htmlFor="ap-dur">
        <Input
          id="ap-dur"
          type="number"
          min={5}
          step={5}
          {...register("durationMinutes", { valueAsNumber: true })}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Admin notes" htmlFor="ap-notes">
          <Input id="ap-notes" {...register("notesAdmin")} />
        </Field>
      </div>
      {message && (
        <p className="text-sm text-danger sm:col-span-2">{message}</p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Create"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
