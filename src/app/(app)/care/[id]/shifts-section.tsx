"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import type { CareShiftStatus } from "@/lib/domain/care";
import { changeCareShiftStatusAction, createCareShiftAction } from "../actions";

export interface ShiftRow {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  visitNotes: string | null;
  caregiver: string;
}

const TZ = "America/Toronto";

const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-warm text-muted",
  confirmed: "bg-primary-soft text-primary-hover",
  in_progress: "bg-primary-soft text-primary-hover",
  completed: "bg-success-soft text-success",
  cancelled: "bg-danger/10 text-danger",
  no_show: "bg-danger/10 text-danger",
};

/** Visit lifecycle quick actions per current status. */
const ACTIONS: Record<string, { to: CareShiftStatus; label: string }[]> = {
  scheduled: [
    { to: "confirmed", label: "Confirm" },
    { to: "in_progress", label: "Check in" },
    { to: "cancelled", label: "Cancel" },
    { to: "no_show", label: "No-show" },
  ],
  confirmed: [
    { to: "in_progress", label: "Check in" },
    { to: "cancelled", label: "Cancel" },
    { to: "no_show", label: "No-show" },
  ],
  in_progress: [{ to: "completed", label: "Check out" }],
};

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: TZ,
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  });
}

export function ShiftsSection({
  agreementId,
  weekStart,
  shifts,
  caregivers,
  canSchedule,
  canUpdate,
  agreementStatus,
}: {
  agreementId: string;
  weekStart: string;
  shifts: ShiftRow[];
  caregivers: { id: string; label: string }[];
  canSchedule: boolean;
  canUpdate: boolean;
  agreementStatus: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caregiverId, setCaregiverId] = useState("");
  const [date, setDate] = useState(weekStart);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("13:00");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  function addShift() {
    setError(null);
    startTransition(async () => {
      const res = await createCareShiftAction(agreementId, {
        caregiverId,
        startAt: new Date(`${date}T${startTime}`).toISOString(),
        endAt: new Date(`${date}T${endTime}`).toISOString(),
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error ?? "Could not create shift.");
      }
    });
  }

  function changeStatus(shiftId: string, to: CareShiftStatus) {
    let reason: string | undefined;
    if (to === "cancelled" || to === "no_show") {
      reason =
        window.prompt(
          to === "cancelled" ? "Cancellation reason:" : "No-show reason:",
        ) ?? undefined;
      if (!reason) return;
    }
    const visitNotes = to === "completed" && noteFor === shiftId ? noteText : "";
    setError(null);
    startTransition(async () => {
      const res = await changeCareShiftStatusAction(shiftId, {
        status: to,
        reason: reason ?? "",
        visitNotes,
      });
      if (res.ok) {
        setNoteFor(null);
        setNoteText("");
        router.refresh();
      } else {
        setError(res.error ?? "Could not update shift.");
      }
    });
  }

  const schedulable = agreementStatus === "active" || agreementStatus === "draft";

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-md border border-border">
        {shifts.length === 0 && (
          <li className="p-4 text-center text-sm text-muted">
            No shifts scheduled this week.
          </li>
        )}
        {shifts.map((s) => (
          <li key={s.id} className="space-y-2 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium">{fmtDay(s.startAt)}</span>{" "}
                <span className="tabular-nums">
                  {fmtTime(s.startAt)}–{fmtTime(s.endAt)}
                </span>{" "}
                · {s.caregiver}
                {s.checkInAt && (
                  <span className="text-xs text-muted">
                    {" "}
                    · in {fmtTime(s.checkInAt)}
                    {s.checkOutAt ? ` / out ${fmtTime(s.checkOutAt)}` : ""}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[s.status] ?? ""}`}
                >
                  {s.status.replace("_", " ")}
                </span>
                {canUpdate &&
                  ACTIONS[s.status]?.map((a) => (
                    <button
                      key={a.to}
                      onClick={() => {
                        if (a.to === "completed" && noteFor !== s.id) {
                          setNoteFor(s.id);
                          return;
                        }
                        changeStatus(s.id, a.to);
                      }}
                      disabled={pending}
                      className={`rounded-md border px-2 py-1 text-xs font-medium ${
                        a.to === "cancelled" || a.to === "no_show"
                          ? "border-danger/40 text-danger hover:bg-danger/10"
                          : "border-border hover:bg-warm"
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
              </div>
            </div>
            {s.visitNotes && (
              <p className="rounded-md bg-success-soft p-2 text-xs">
                {s.visitNotes}
              </p>
            )}
            {noteFor === s.id && s.status === "in_progress" && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs">
                  <span className="font-medium">Visit note (what was done)</span>
                  <textarea
                    className={`${inputClass} min-h-16`}
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                  />
                </label>
                <Button onClick={() => changeStatus(s.id, "completed")} disabled={pending}>
                  Check out
                </Button>
                <Button variant="ghost" onClick={() => setNoteFor(null)}>
                  Cancel
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="text-sm text-danger">{error}</p>}

      {canSchedule && !open && (
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => setOpen(true)}
            disabled={!schedulable}
          >
            Add shift
          </Button>
          {!schedulable && (
            <span className="text-xs text-muted">
              Shifts can only be added while the agreement is draft or active.
            </span>
          )}
        </div>
      )}

      {canSchedule && open && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
          <label className="flex min-w-48 flex-col gap-1 text-sm">
            <span className="font-medium">Caregiver</span>
            <select
              className={inputClass}
              value={caregiverId}
              onChange={(e) => setCaregiverId(e.target.value)}
            >
              <option value="">Select…</option>
              {caregivers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {caregivers.length === 0 && (
              <span className="text-xs text-warning">
                No caregivers yet — mark employees as Caregiver in Settings.
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Date</span>
            <input
              type="date"
              className={inputClass}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Start</span>
            <input
              type="time"
              className={inputClass}
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">End</span>
            <input
              type="time"
              className={inputClass}
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </label>
          <Button onClick={addShift} disabled={pending || !caregiverId || !date}>
            {pending ? "Saving…" : "Schedule shift"}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
