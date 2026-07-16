"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TemplateField } from "@/lib/domain/encounter";
import { validateAnswers } from "@/lib/domain/encounter";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClass } from "@/components/ui/field";
import {
  addAmendmentAction,
  addMeasurementAction,
  saveDraftAction,
  signEncounterAction,
} from "../actions";

export interface WorkspaceEncounter {
  id: string;
  status: "draft" | "signed" | "amended" | "entered_in_error";
  summary: string | null;
  contentSnapshot: Record<string, unknown>;
  contentHash: string | null;
  signedAt: string | null;
}

export interface Amendment {
  id: string;
  body: string;
  authoredAt: string;
}

export interface Measurement {
  id: string;
  observationType: string;
  valueNumeric: number | null;
  valueText: string | null;
  unit: string | null;
}

export function EncounterWorkspace({
  encounter,
  fields,
  amendments,
  measurements,
}: {
  encounter: WorkspaceEncounter;
  fields: TemplateField[];
  amendments: Amendment[];
  measurements: Measurement[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [answers, setAnswers] = useState<Record<string, unknown>>(
    encounter.contentSnapshot ?? {},
  );
  const [summary, setSummary] = useState(encounter.summary ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const isDraft = encounter.status === "draft";

  function setField(key: string, value: unknown) {
    setAnswers((a) => ({ ...a, [key]: value }));
  }

  function saveDraft() {
    setMessage(null);
    startTransition(async () => {
      const res = await saveDraftAction(encounter.id, { answers, summary });
      setMessage(res.ok ? "Draft saved." : (res.error ?? "Save failed."));
      if (res.ok) router.refresh();
    });
  }

  function sign() {
    const v = validateAnswers({ fields }, answers);
    if (!v.ok) {
      setErrors(v.errors);
      setMessage("Fix validation errors before signing.");
      return;
    }
    if (!window.confirm("Sign this note? Signed notes are immutable.")) return;
    setMessage(null);
    startTransition(async () => {
      // Persist latest answers first, then sign.
      const saved = await saveDraftAction(encounter.id, { answers, summary });
      if (!saved.ok) {
        setMessage(saved.error ?? "Save failed.");
        return;
      }
      const res = await signEncounterAction(encounter.id);
      setMessage(res.ok ? "Signed." : (res.error ?? "Sign failed."));
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Template answers */}
      <div className="space-y-4">
        {fields.length === 0 && (
          <p className="text-sm text-muted">
            No template attached. Use the summary field to record the note.
          </p>
        )}
        {fields.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={`f-${f.key}`} error={errors[f.key]}>
            {renderField(f, answers[f.key], (v) => setField(f.key, v), !isDraft)}
          </Field>
        ))}
        <Field label="Summary" htmlFor="summary">
          <textarea
            id="summary"
            className={`${inputClass} min-h-24`}
            value={summary}
            disabled={!isDraft}
            onChange={(e) => setSummary(e.target.value)}
          />
        </Field>
      </div>

      {message && <p className="text-sm text-muted">{message}</p>}

      {isDraft ? (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={saveDraft} disabled={pending}>
            Save draft
          </Button>
          <Button onClick={sign} disabled={pending}>
            Sign
          </Button>
        </div>
      ) : (
        <div className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">
          <p className="font-medium text-success">
            Signed note — immutable (FR-ENC-004).
          </p>
          {encounter.contentHash && (
            <p className="mt-1 break-all text-xs text-muted">
              hash: {encounter.contentHash}
            </p>
          )}
        </div>
      )}

      {/* Measurements */}
      <MeasurementsPanel
        encounterId={encounter.id}
        measurements={measurements}
        onChanged={() => router.refresh()}
      />

      {/* Amendments (only when signed) */}
      {!isDraft && (
        <AmendmentsPanel
          encounterId={encounter.id}
          amendments={amendments}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

function renderField(
  f: TemplateField,
  value: unknown,
  onChange: (v: unknown) => void,
  disabled: boolean,
) {
  const common = { id: `f-${f.key}`, disabled };
  switch (f.type) {
    case "textarea":
      return (
        <textarea
          {...common}
          className={`${inputClass} min-h-20`}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "select":
      return (
        <select
          {...common}
          className={inputClass}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select…</option>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "scale":
    case "number":
      return (
        <Input
          {...common}
          type="number"
          min={f.min}
          max={f.max}
          value={(value as number) ?? ""}
          onChange={(e) => onChange(e.target.valueAsNumber)}
        />
      );
    case "date":
      return (
        <Input
          {...common}
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "checkbox":
      return (
        <input
          {...common}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    default:
      return (
        <Input
          {...common}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function MeasurementsPanel({
  encounterId,
  measurements,
  onChanged,
}: {
  encounterId: string;
  measurements: Measurement[];
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState("");
  const [val, setVal] = useState("");
  const [unit, setUnit] = useState("");

  function add() {
    if (!type) return;
    const numeric = Number(val);
    startTransition(async () => {
      const res = await addMeasurementAction(encounterId, {
        observationType: type,
        valueNumeric: Number.isFinite(numeric) && val !== "" ? Math.round(numeric) : undefined,
        valueText: val !== "" && !Number.isFinite(numeric) ? val : undefined,
        unit: unit || undefined,
      });
      if (res.ok) {
        setType("");
        setVal("");
        setUnit("");
        onChanged();
      }
    });
  }

  return (
    <div className="rounded-md border border-border p-4">
      <h3 className="text-sm font-semibold">Measurements</h3>
      <ul className="mt-2 divide-y divide-border text-sm">
        {measurements.length === 0 && (
          <li className="py-2 text-muted">No measurements.</li>
        )}
        {measurements.map((m) => (
          <li key={m.id} className="flex justify-between py-2">
            <span>{m.observationType}</span>
            <span className="text-muted">
              {m.valueNumeric ?? m.valueText} {m.unit}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          className={`${inputClass} max-w-40`}
          placeholder="Type (e.g. weight)"
          value={type}
          onChange={(e) => setType(e.target.value)}
        />
        <input
          className={`${inputClass} max-w-28`}
          placeholder="Value"
          value={val}
          onChange={(e) => setVal(e.target.value)}
        />
        <input
          className={`${inputClass} max-w-24`}
          placeholder="Unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
        <Button variant="secondary" onClick={add} disabled={pending || !type}>
          Add
        </Button>
      </div>
    </div>
  );
}

function AmendmentsPanel({
  encounterId,
  amendments,
  onChanged,
}: {
  encounterId: string;
  amendments: Amendment[];
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    startTransition(async () => {
      const res = await addAmendmentAction(encounterId, { body });
      if (res.ok) {
        setBody("");
        onChanged();
      } else {
        setError(res.error ?? "Failed to add amendment.");
      }
    });
  }

  return (
    <div className="rounded-md border border-border p-4">
      <h3 className="text-sm font-semibold">Amendments</h3>
      <ul className="mt-2 space-y-2 text-sm">
        {amendments.length === 0 && (
          <li className="text-muted">No amendments.</li>
        )}
        {amendments.map((a) => (
          <li key={a.id} className="rounded-md bg-background p-2">
            <div className="text-xs text-muted">
              {new Date(a.authoredAt).toLocaleString("en-CA")}
            </div>
            <div>{a.body}</div>
          </li>
        ))}
      </ul>
      <div className="mt-3 space-y-2">
        <textarea
          className={`${inputClass} min-h-20`}
          placeholder="Add a correction without altering the original note…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button variant="secondary" onClick={add} disabled={pending || !body.trim()}>
          Add amendment
        </Button>
      </div>
    </div>
  );
}
