"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { updateAppointmentAction } from "../actions";

interface Option {
  id: string;
  label: string;
}

/** datetime-local value (clinic timezone) for a UTC instant. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function EditAppointmentForm({
  appointmentId,
  defaults,
  employees,
  services,
}: {
  appointmentId: string;
  defaults: {
    employeeId: string;
    serviceId: string;
    startAt: string;
    durationMinutes: number;
    modality: string;
    notesAdmin: string;
  };
  employees: Option[];
  services: Option[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [employeeId, setEmployeeId] = useState(defaults.employeeId);
  const [serviceId, setServiceId] = useState(defaults.serviceId);
  const [startAt, setStartAt] = useState(toLocalInput(defaults.startAt));
  const [duration, setDuration] = useState(String(defaults.durationMinutes));
  const [modality, setModality] = useState(defaults.modality);
  const [notes, setNotes] = useState(defaults.notesAdmin);
  const [message, setMessage] = useState<string | null>(null);

  function save() {
    setMessage(null);
    const start = new Date(startAt);
    const end = new Date(start.getTime() + Number(duration) * 60_000);
    startTransition(async () => {
      const res = await updateAppointmentAction(appointmentId, {
        employeeId,
        serviceId,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        modality,
        notesAdmin: notes,
      });
      if (res.ok) {
        setMessage("Saved.");
        router.refresh();
      } else {
        setMessage(res.error ?? "Could not save the appointment.");
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Practitioner</span>
        <select
          className={inputClass}
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
        >
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Service</span>
        <select
          className={inputClass}
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
        >
          <option value="">None</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Modality</span>
        <select
          className={inputClass}
          value={modality}
          onChange={(e) => setModality(e.target.value)}
        >
          <option value="in_person">In person</option>
          <option value="virtual">Virtual</option>
          <option value="phone">Phone</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Start</span>
        <input
          type="datetime-local"
          className={inputClass}
          value={startAt}
          onChange={(e) => setStartAt(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Duration (min)</span>
        <input
          type="number"
          min={5}
          step={5}
          className={inputClass}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2 lg:col-span-3">
        <span className="font-medium">Booking notes</span>
        <textarea
          className={`${inputClass} min-h-16`}
          placeholder="Context for the visit: reason, requests, reminders…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      {message && (
        <p
          className={`text-sm sm:col-span-2 lg:col-span-3 ${
            message === "Saved." ? "text-success" : "text-danger"
          }`}
        >
          {message}
        </p>
      )}
      <div className="sm:col-span-2 lg:col-span-3">
        <Button onClick={save} disabled={pending || !startAt || !employeeId}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
