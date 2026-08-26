"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { createCareAgreementAction } from "./actions";

export function NewAgreementForm({
  patients,
}: {
  patients: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [patientId, setPatientId] = useState("");
  const [weeklyHours, setWeeklyHours] = useState("20");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rate, setRate] = useState("35");
  const [address, setAddress] = useState("");
  const [carePlan, setCarePlan] = useState("");
  const [tasksText, setTasksText] = useState(
    "Companionship, Meal preparation, Medication reminders",
  );

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createCareAgreementAction({
        patientId,
        weeklyHours: Number(weeklyHours),
        startDate,
        endDate,
        hourlyRateDollars: Number(rate || "0"),
        address,
        carePlan,
        defaultTasks: tasksText
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      if (res.ok && res.id) {
        setOpen(false);
        router.push(`/care/${res.id}`);
        router.refresh();
      } else {
        setError(res.error ?? "Could not create agreement.");
      }
    });
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>New agreement</Button>;
  }

  return (
    <div className="w-full rounded-2xl border border-border bg-surface p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="text-sm font-semibold sm:col-span-3">
          New home-care agreement
        </div>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium">Client (senior)</span>
          <select
            className={inputClass}
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
          >
            <option value="">Select client…</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">
            The client is registered as a patient — create them in Patients
            first if missing.
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Hours per week</span>
          <input
            type="number"
            min={0.5}
            step={0.5}
            className={inputClass}
            value={weeklyHours}
            onChange={(e) => setWeeklyHours(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Start date</span>
          <input
            type="date"
            className={inputClass}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">End date (optional)</span>
          <input
            type="date"
            className={inputClass}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Hourly rate (CAD)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            className={inputClass}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-3">
          <span className="font-medium">Care address</span>
          <input
            className={inputClass}
            placeholder="Where care is provided (client's home)"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-3">
          <span className="font-medium">Default visit tasks (comma-separated)</span>
          <input
            className={inputClass}
            placeholder="Companionship, Meal preparation, Light housekeeping…"
            value={tasksText}
            onChange={(e) => setTasksText(e.target.value)}
          />
          <span className="text-xs text-muted">
            Copied as a checklist onto every new shift.
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-3">
          <span className="font-medium">Care plan</span>
          <textarea
            className={`${inputClass} min-h-20`}
            placeholder="Routines, mobility, medication reminders, meals, companionship…"
            value={carePlan}
            onChange={(e) => setCarePlan(e.target.value)}
          />
        </label>
        {error && <p className="text-sm text-danger sm:col-span-3">{error}</p>}
        <div className="flex gap-2 sm:col-span-3">
          <Button
            onClick={submit}
            disabled={pending || !patientId || !startDate || !weeklyHours}
          >
            {pending ? "Creating…" : "Create agreement"}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
