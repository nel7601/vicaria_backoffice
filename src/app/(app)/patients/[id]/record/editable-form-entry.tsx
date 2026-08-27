"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TemplateField } from "@/lib/domain/encounter";
import { validateAnswers } from "@/lib/domain/encounter";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { TemplateFieldInput } from "@/components/forms/template-field-input";
import { deletePatientFormAction, updatePatientFormAction } from "./actions";

function answerText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * One directly-filled form inside a record tab: read-only by default, with
 * an Edit mode to complete answers that were missing when it was filled.
 */
export function EditableFormEntry({
  formId,
  fields,
  answers: initialAnswers,
  filledAt: initialFilledAt,
  dateLabel,
  byLine,
  today,
  canEdit,
}: {
  formId: string;
  fields: TemplateField[];
  answers: Record<string, unknown>;
  /** YYYY-MM-DD in the clinic timezone. */
  filledAt: string;
  dateLabel: string;
  byLine: string;
  today: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [filledAt, setFilledAt] = useState(initialFilledAt);
  const [answers, setAnswers] = useState(initialAnswers);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setEditing(false);
    setAnswers(initialAnswers);
    setFilledAt(initialFilledAt);
    setErrors({});
    setError(null);
  }

  function remove() {
    const reason = window.prompt(
      "Delete this filled form? This cannot be undone.\nReason for deletion:",
    );
    if (!reason?.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await deletePatientFormAction(formId, reason);
      if (res.ok) router.refresh();
      else setError(res.error ?? "Could not delete the form.");
    });
  }

  function save() {
    setError(null);
    const v = validateAnswers({ fields }, answers);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await updatePatientFormAction(formId, { filledAt, answers });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError(res.error ?? "Could not save the form.");
      }
    });
  }

  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">
          {editing ? (
            <label className="flex items-center gap-2">
              <span>Date</span>
              <input
                type="date"
                className={inputClass}
                value={filledAt}
                max={today}
                onChange={(e) => setFilledAt(e.target.value)}
              />
            </label>
          ) : (
            <>
              {dateLabel} · {byLine}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">
            filled directly
          </span>
          {canEdit && !editing && (
            <>
              <button
                onClick={() => setEditing(true)}
                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-background"
              >
                Edit
              </button>
              <button
                onClick={remove}
                disabled={pending}
                className="rounded-md border border-danger/40 px-2 py-1 text-xs text-danger hover:bg-danger/10"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {!editing && error && <p className="mt-2 text-sm text-danger">{error}</p>}

      {editing ? (
        <div className="mt-3 space-y-4">
          {fields.map((f) =>
            f.type === "heading" ? (
              <h3
                key={f.key}
                className="border-b border-border pb-1 pt-2 text-sm font-semibold"
              >
                {f.label}
              </h3>
            ) : (
              <Field
                key={f.key}
                label={f.label}
                htmlFor={`f-${f.key}`}
                error={errors[f.key]}
              >
                <TemplateFieldInput
                  field={f}
                  value={answers[f.key]}
                  onChange={(v) => setAnswers((a) => ({ ...a, [f.key]: v }))}
                />
              </Field>
            ),
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={save} disabled={pending || !filledAt}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="secondary" onClick={cancel} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          {fields.map((f) =>
            f.type === "heading" ? (
              <div
                key={f.key}
                className="border-b border-border pb-1 pt-2 font-semibold sm:col-span-2"
              >
                {f.label}
              </div>
            ) : (
              <div key={f.key} className="flex justify-between gap-4 sm:block">
                <dt className="text-muted">{f.label}</dt>
                <dd className="whitespace-pre-wrap">
                  {answerText(answers[f.key])}
                </dd>
              </div>
            ),
          )}
          {fields.length === 0 && (
            <div className="text-muted">No fields in this version.</div>
          )}
        </dl>
      )}
    </div>
  );
}
