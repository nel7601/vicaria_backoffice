"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TemplateField } from "@/lib/domain/encounter";
import { validateAnswers } from "@/lib/domain/encounter";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { TemplateFieldInput } from "@/components/forms/template-field-input";
import { addPatientFileFormAction } from "./file-form-actions";

export interface FileFormOption {
  templateId: string;
  versionId: string;
  name: string;
  fields: TemplateField[];
}

export interface FiledForm {
  id: string;
  templateName: string;
  filledAtLabel: string;
  byLine: string;
  fields: TemplateField[];
  answers: Record<string, unknown>;
}

function answerText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * Documents on the patient's file: signed releases, authorizations — things
 * the patient put their name to that belong with the record but are not
 * clinical history, and so are deliberately absent from the chart.
 */
export function PatientFileForms({
  patientId,
  forms,
  filed,
  today,
  canAdd,
}: {
  patientId: string;
  forms: FileFormOption[];
  filed: FiledForm[];
  today: string;
  canAdd: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [versionId, setVersionId] = useState("");
  const [filledAt, setFilledAt] = useState(today);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const selected = forms.find((f) => f.versionId === versionId) ?? null;

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
      const res = await addPatientFileFormAction({
        patientId,
        templateVersionId: selected.versionId,
        filledAt,
        answers,
      });
      if (res.ok) {
        setOpen(false);
        setVersionId("");
        setAnswers({});
        router.refresh();
      } else {
        setError(res.error ?? "Could not file the form.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border text-sm">
        {filed.length === 0 && (
          <li className="py-2 text-muted">No documents on file.</li>
        )}
        {filed.map((f) => (
          <li key={f.id} className="py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">{f.templateName}</span>
                <span className="text-muted">
                  {" "}
                  · signed {f.filledAtLabel} · filed by {f.byLine}
                </span>
              </span>
              <button
                onClick={() => setExpanded(expanded === f.id ? null : f.id)}
                className="text-sm text-primary hover:underline"
              >
                {expanded === f.id ? "Hide" : "View"}
              </button>
            </div>
            {expanded === f.id && (
              <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 rounded-md bg-surface-muted p-3 text-sm">
                {f.fields.map((field) =>
                  field.type === "heading" ? (
                    <div
                      key={field.key}
                      className="border-b border-border pb-1 pt-2 font-semibold"
                    >
                      {field.label}
                    </div>
                  ) : (
                    <div key={field.key} className="flex justify-between gap-4">
                      <dt className="text-muted">{field.label}</dt>
                      <dd className="shrink-0 whitespace-pre-wrap font-medium">
                        {answerText(f.answers[field.key])}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            )}
          </li>
        ))}
      </ul>

      {canAdd && forms.length > 0 && !open && (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          + Add document
        </Button>
      )}

      {canAdd && open && (
        <div className="rounded-2xl border border-border p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Add document</div>
            <button
              onClick={() => setOpen(false)}
              className="text-sm text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="font-medium">Document</span>
              <select
                className={inputClass}
                value={versionId}
                onChange={(e) => {
                  setVersionId(e.target.value);
                  setAnswers({});
                  setErrors({});
                  setError(null);
                }}
              >
                <option value="">Select a document…</option>
                {forms.map((f) => (
                  <option key={f.versionId} value={f.versionId}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Date signed</span>
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
              {selected.fields.map((f) =>
                f.type === "heading" ? (
                  <h3
                    key={f.key}
                    className="border-b border-border pb-1 pt-2 text-sm font-semibold"
                  >
                    {f.label}
                  </h3>
                ) : f.type === "checkbox" ? (
                  // Consent paragraphs read as a statement the patient ticks,
                  // so the text sits beside the box, not above it.
                  <label
                    key={f.key}
                    className="flex items-start gap-2 text-sm"
                    htmlFor={`f-${f.key}`}
                  >
                    <TemplateFieldInput
                      field={f}
                      value={answers[f.key]}
                      onChange={(v) => setAnswers((a) => ({ ...a, [f.key]: v }))}
                    />
                    <span>
                      {f.label}
                      {f.required && <span className="text-danger"> *</span>}
                      {errors[f.key] && (
                        <span className="block text-xs text-danger">
                          {errors[f.key]}
                        </span>
                      )}
                    </span>
                  </label>
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
                {pending ? "Filing…" : "File document"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
