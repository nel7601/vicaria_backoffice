"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { addChartNoteAction } from "./actions";

/** Add a dated note to the clinical record (e.g. a follow-up phone call). */
export function AddNoteForm({
  patientId,
  today,
}: {
  patientId: string;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notedAt, setNotedAt] = useState(today);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await addChartNoteAction({ patientId, notedAt, body });
      if (res.ok) {
        setBody("");
        router.refresh();
      } else {
        setError(res.error ?? "Could not save the note.");
      }
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-warm/40 p-4">
      <div className="text-sm font-semibold">Add note</div>
      <p className="mt-0.5 text-xs text-muted">
        Progress notes outside a visit — a follow-up call, recovery check,
        instructions given, etc.
      </p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Date</span>
          <input
            type="date"
            className={inputClass}
            value={notedAt}
            max={today}
            onChange={(e) => setNotedAt(e.target.value)}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Note</span>
          <textarea
            className={`${inputClass} min-h-16`}
            placeholder="Called the patient to check on recovery…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <div className="mt-3">
        <Button onClick={save} disabled={pending || !body.trim() || !notedAt}>
          {pending ? "Saving…" : "Add note"}
        </Button>
      </div>
    </div>
  );
}
