"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TemplateField } from "@/lib/domain/encounter";
import { validateAnswers } from "@/lib/domain/encounter";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { TemplateFieldInput } from "@/components/forms/template-field-input";
import { addPatientFormAction } from "./actions";

export interface FormOption {
  templateId: string;
  versionId: string;
  name: string;
  fields: TemplateField[];
}

/**
 * "Add form": pick one of the published forms, fill it in and save. The
 * response becomes an entry in that form's tab of the clinical record.
 */
export function AddFormPanel({
  patientId,
  forms,
  today,
  from,
}: {
  patientId: string;
  forms: FormOption[];
  today: string;
  /** Where the record was opened from, kept so the back link survives a save. */
  from?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [versionId, setVersionId] = useState("");
  const [filledAt, setFilledAt] = useState(today);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const selected = forms.find((f) => f.versionId === versionId) ?? null;

  function pickForm(id: string) {
    setVersionId(id);
    setAnswers({});
    setErrors({});
    setError(null);
  }

  function save() {
    if (!selected) return;
    setError(null);
    const v = validateAnswers({ fields: selected.fields }, answers);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await addPatientFormAction({
        patientId,
        templateVersionId: selected.versionId,
        filledAt,
        answers,
      });
      if (res.ok) {
        setOpen(false);
        setVersionId("");
        setAnswers({});
        router.push(
          `/patients/${patientId}/record?tab=${selected.templateId}${
            from ? `&from=${encodeURIComponent(from)}` : ""
          }`,
        );
        router.refresh();
      } else {
        setError(res.error ?? "Could not save the form.");
      }
    });
  }

  if (forms.length === 0) return null;

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        + Add form
      </Button>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Add form</div>
        <button
          onClick={() => setOpen(false)}
          className="text-sm text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Form</span>
          <select
            className={inputClass}
            value={versionId}
            onChange={(e) => pickForm(e.target.value)}
          >
            <option value="">Select a form…</option>
            {forms.map((f) => (
              <option key={f.versionId} value={f.versionId}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Date</span>
          <input
            type="date"
            className={inputClass}
            value={filledAt}
            max={today}
            onChange={(e) => setFilledAt(e.target.value)}
          />
        </label>
      </div>

      {selected && (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          {selected.fields.length === 0 && (
            <p className="text-sm text-muted">This form has no fields.</p>
          )}
          {selected.fields.map((f) =>
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
          <Button onClick={save} disabled={pending || !filledAt}>
            {pending ? "Saving…" : "Save form"}
          </Button>
        </div>
      )}
    </div>
  );
}
