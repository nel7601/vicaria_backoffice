"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { formatMinutes, type CareShiftStatus } from "@/lib/domain/care";
import {
  approveShiftHoursAction,
  changeCareShiftStatusAction,
  createCareShiftAction,
  reportCareIncidentAction,
  updateShiftTasksAction,
} from "../actions";

export interface ShiftTask {
  label: string;
  status: string; // pending | done | not_done | na
  comment?: string;
}

export interface ShiftRow {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  visitNotes: string | null;
  tasks: ShiftTask[];
  approvedMinutes: number | null;
  caregiver: string;
}

const TZ = "America/Toronto";

const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-warm text-muted",
  confirmed: "bg-primary-soft text-primary-hover",
  in_progress: "bg-primary-soft text-primary-hover",
  completed: "bg-success-soft text-success",
  needs_review: "bg-ring/15 text-warning",
  cancelled: "bg-danger/10 text-danger",
  no_show: "bg-danger/10 text-danger",
  missed: "bg-danger/10 text-danger",
};

/** Visit lifecycle quick actions per current status (spec §10.3). */
const ACTIONS: Record<string, { to: CareShiftStatus; label: string }[]> = {
  scheduled: [
    { to: "confirmed", label: "Confirm" },
    { to: "in_progress", label: "Check in" },
    { to: "cancelled", label: "Cancel" },
    { to: "no_show", label: "No-show" },
    { to: "missed", label: "Missed" },
  ],
  confirmed: [
    { to: "in_progress", label: "Check in" },
    { to: "cancelled", label: "Cancel" },
    { to: "no_show", label: "No-show" },
    { to: "missed", label: "Missed" },
  ],
  in_progress: [{ to: "completed", label: "Check out" }],
};

const TASK_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "done", label: "Done" },
  { value: "not_done", label: "Not done" },
  { value: "na", label: "N/A" },
];

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
  // Per-shift expanded panels
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [incidentFor, setIncidentFor] = useState<string | null>(null);
  const [incidentSeverity, setIncidentSeverity] = useState("medium");
  const [incidentText, setIncidentText] = useState("");
  const [taskDrafts, setTaskDrafts] = useState<Record<string, ShiftTask[]>>({});

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
    if (to === "cancelled" || to === "no_show" || to === "missed") {
      reason = window.prompt("Reason:") ?? undefined;
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

  function approve(shiftId: string) {
    setError(null);
    startTransition(async () => {
      const res = await approveShiftHoursAction(shiftId, {});
      if (res.ok) router.refresh();
      else setError(res.error ?? "Could not approve hours.");
    });
  }

  function saveTasks(shiftId: string) {
    const tasks = taskDrafts[shiftId];
    if (!tasks) return;
    setError(null);
    startTransition(async () => {
      const res = await updateShiftTasksAction(shiftId, { tasks });
      if (res.ok) {
        setTaskDrafts((d) => {
          const next = { ...d };
          delete next[shiftId];
          return next;
        });
        router.refresh();
      } else {
        setError(res.error ?? "Could not save tasks.");
      }
    });
  }

  function submitIncident(shiftId: string) {
    setError(null);
    startTransition(async () => {
      const res = await reportCareIncidentAction(shiftId, {
        severity: incidentSeverity,
        description: incidentText,
      });
      if (res.ok) {
        setIncidentFor(null);
        setIncidentText("");
        router.refresh();
      } else {
        setError(res.error ?? "Could not report incident.");
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
        {shifts.map((s) => {
          const tasks = taskDrafts[s.id] ?? s.tasks;
          const editableTasks = canUpdate && s.status === "in_progress";
          return (
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
                  {s.approvedMinutes !== null && (
                    <span className="text-xs text-success">
                      {" "}
                      · {formatMinutes(s.approvedMinutes)} approved
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
                          ["cancelled", "no_show", "missed"].includes(a.to)
                            ? "border-danger/40 text-danger hover:bg-danger/10"
                            : "border-border hover:bg-warm"
                        }`}
                      >
                        {a.label}
                      </button>
                    ))}
                  {canUpdate && s.status === "needs_review" && (
                    <button
                      onClick={() => approve(s.id)}
                      disabled={pending}
                      className="rounded-md border border-success/40 px-2 py-1 text-xs font-medium text-success hover:bg-success-soft"
                    >
                      Approve hours
                    </button>
                  )}
                  {canUpdate &&
                    ["in_progress", "completed", "needs_review"].includes(
                      s.status,
                    ) && (
                      <button
                        onClick={() =>
                          setIncidentFor(incidentFor === s.id ? null : s.id)
                        }
                        className="rounded-md border border-warning/40 px-2 py-1 text-xs font-medium text-warning hover:bg-ring/10"
                      >
                        Report incident
                      </button>
                    )}
                </div>
              </div>

              {/* Task checklist (spec §10.2) */}
              {tasks.length > 0 && (
                <div className="rounded-md bg-background p-2">
                  <div className="mb-1 text-xs font-medium uppercase text-muted">
                    Visit tasks
                  </div>
                  <ul className="space-y-1">
                    {tasks.map((t, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="min-w-40 flex-1">{t.label}</span>
                        {editableTasks ? (
                          <select
                            className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                            value={t.status}
                            onChange={(e) =>
                              setTaskDrafts((d) => ({
                                ...d,
                                [s.id]: tasks.map((tt, ii) =>
                                  ii === i ? { ...tt, status: e.target.value } : tt,
                                ),
                              }))
                            }
                          >
                            {TASK_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            className={`rounded-full px-2 py-0.5 ${
                              t.status === "done"
                                ? "bg-success-soft text-success"
                                : t.status === "not_done"
                                  ? "bg-danger/10 text-danger"
                                  : "bg-warm text-muted"
                            }`}
                          >
                            {TASK_OPTIONS.find((o) => o.value === t.status)?.label ?? t.status}
                          </span>
                        )}
                        {editableTasks && t.status === "not_done" && (
                          <input
                            className="min-w-40 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs"
                            placeholder="Why not done?"
                            value={t.comment ?? ""}
                            onChange={(e) =>
                              setTaskDrafts((d) => ({
                                ...d,
                                [s.id]: tasks.map((tt, ii) =>
                                  ii === i ? { ...tt, comment: e.target.value } : tt,
                                ),
                              }))
                            }
                          />
                        )}
                        {!editableTasks && t.comment && (
                          <span className="text-muted">— {t.comment}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {editableTasks && taskDrafts[s.id] && (
                    <Button
                      variant="secondary"
                      className="mt-2 px-3 py-1 text-xs"
                      onClick={() => saveTasks(s.id)}
                      disabled={pending}
                    >
                      Save tasks
                    </Button>
                  )}
                </div>
              )}

              {s.visitNotes && (
                <p className="rounded-md bg-success-soft p-2 text-xs">
                  {s.visitNotes}
                </p>
              )}

              {/* Check-out note */}
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
                  <Button
                    onClick={() => changeStatus(s.id, "completed")}
                    disabled={pending}
                  >
                    Check out
                  </Button>
                  <Button variant="ghost" onClick={() => setNoteFor(null)}>
                    Cancel
                  </Button>
                </div>
              )}

              {/* Incident report (spec §10.2) */}
              {incidentFor === s.id && (
                <div className="flex flex-wrap items-end gap-2 rounded-md border border-warning/40 p-2">
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="font-medium">Severity</span>
                    <select
                      className={inputClass}
                      value={incidentSeverity}
                      onChange={(e) => setIncidentSeverity(e.target.value)}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </label>
                  <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs">
                    <span className="font-medium">What happened</span>
                    <textarea
                      className={`${inputClass} min-h-16`}
                      value={incidentText}
                      onChange={(e) => setIncidentText(e.target.value)}
                    />
                  </label>
                  <Button
                    onClick={() => submitIncident(s.id)}
                    disabled={pending || incidentText.trim().length < 5}
                  >
                    Report
                  </Button>
                  <Button variant="ghost" onClick={() => setIncidentFor(null)}>
                    Cancel
                  </Button>
                </div>
              )}
            </li>
          );
        })}
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
