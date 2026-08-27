"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  canTransition,
  transitionRequiresReason,
  type AppointmentStatus,
} from "@/lib/domain/appointment";
import { changeAppointmentStatusAction } from "../actions";
import { startEncounterFromAppointmentAction } from "../../encounters/actions";

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
  confirmed: "bg-primary/10 text-primary",
  checked_in: "bg-primary/10 text-primary",
  in_progress: "bg-warning/10 text-warning",
  completed: "bg-success/10 text-success",
  cancelled: "bg-danger/10 text-danger",
  no_show: "bg-danger/10 text-danger",
  rescheduled: "bg-border text-muted",
};

/** Status badge + quick actions for the appointment detail header. */
export function AppointmentStatusActions(props: {
  id: string;
  status: string;
  canUpdate: boolean;
  canStartEncounter: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const from = props.status as AppointmentStatus;
  const nextOptions = ALL_STATUSES.filter((s) => canTransition(from, s));

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
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center gap-2">
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
          {props.status.replace("_", " ")}
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
            <option value="">Change status…</option>
            {nextOptions.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
