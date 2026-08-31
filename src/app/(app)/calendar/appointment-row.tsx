"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RecordLink } from "@/components/ui/record-link";
import {
  canTransition,
  transitionRequiresReason,
  type AppointmentStatus,
} from "@/lib/domain/appointment";
import { changeAppointmentStatusAction } from "./actions";
import { startEncounterFromAppointmentAction } from "../encounters/actions";

const ALL_STATUSES: AppointmentStatus[] = [
  "scheduled",
  "confirmed",
  "checked_in",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
];

const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-border text-foreground",
  confirmed: "bg-primary/10 font-medium text-primary",
  checked_in: "bg-primary/10 text-primary",
  in_progress: "bg-warning/10 text-warning",
  completed: "bg-success/10 text-success",
  cancelled: "bg-danger/10 text-danger",
  no_show: "bg-danger/10 text-danger",
  rescheduled: "bg-border text-muted",
};

export function AppointmentRow(props: {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  modality: string;
  patientName: string;
  patientId: string;
  practitioner: string;
  service: string | null;
  canUpdate: boolean;
  canStartEncounter: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const from = props.status as AppointmentStatus;
  const nextOptions = ALL_STATUSES.filter((s) => canTransition(from, s));

  const time = new Date(props.startAt).toLocaleTimeString("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Toronto",
  });

  function changeStatus(to: AppointmentStatus) {
    setError(null);
    let reason: string | undefined;
    if (transitionRequiresReason(to)) {
      reason = window.prompt(`Reason to mark "${to}":`) ?? undefined;
      if (!reason) return;
    }
    startTransition(async () => {
      const res = await changeAppointmentStatusAction(props.id, {
        status: to,
        reason,
      });
      if (res.ok) router.refresh();
      else setError(res.error ?? "Failed to update status.");
    });
  }

  function startEncounter() {
    setError(null);
    startTransition(async () => {
      const res = await startEncounterFromAppointmentAction(props.id);
      if (res.ok && res.encounterId) {
        router.push(`/encounters/${res.encounterId}`);
      } else {
        setError(res.error ?? "Could not start encounter.");
      }
    });
  }

  const encounterEligible =
    props.canStartEncounter &&
    !["cancelled", "no_show", "rescheduled"].includes(props.status);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">
          <span className="tabular-nums">{time}</span>{" "}
          <Link
            href={`/patients/${props.patientId}`}
            className="text-primary hover:underline"
          >
            {props.patientName}
          </Link>{" "}
          <RecordLink patientId={props.patientId} />
        </div>
        <div className="text-xs text-muted">
          {props.practitioner}
          {props.service ? ` · ${props.service}` : ""} · {props.modality}
        </div>
        {error && <div className="text-xs text-danger">{error}</div>}
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={`/calendar/${props.id}`}
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-background"
        >
          View / edit
        </Link>
        {encounterEligible && (
          <button
            onClick={startEncounter}
            disabled={pending}
            className="rounded-md border border-primary/40 px-2 py-1 text-xs text-primary hover:bg-primary/10"
          >
            {pending ? "Opening…" : "Start encounter"}
          </button>
        )}
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[props.status] ?? ""}`}
        >
          {/* Same tick the month grid uses, so confirmation reads the same
              way in both views. */}
          {props.status === "confirmed" ? `✓ ${props.status}` : props.status}
        </span>
        {props.canUpdate && nextOptions.length > 0 && (
          <select
            aria-label="Change status"
            disabled={pending}
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value as AppointmentStatus;
              if (v) changeStatus(v);
              e.target.value = "";
            }}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
          >
            <option value="">Change…</option>
            {nextOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>
    </li>
  );
}
