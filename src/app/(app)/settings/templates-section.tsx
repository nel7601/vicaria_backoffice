"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import type { TemplateFieldInput } from "@/lib/schemas/template";
import {
  createTemplateAction,
  deleteTemplateAction,
  publishTemplateVersionAction,
} from "./actions";
import { deleteBtnClass, editBtnClass } from "./services-section";

export interface TemplateRow {
  templateId: string;
  name: string;
  serviceId: string | null;
  serviceName: string | null;
  version: number | null;
  fields: TemplateFieldInput[];
  usageCount: number;
}

const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "scale",
  "select",
  "date",
  "checkbox",
  "heading",
] as const;

function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "field";
}

interface FieldDraft {
  label: string;
  type: (typeof FIELD_TYPES)[number];
  required: boolean;
  options: string; // comma-separated for select
  min: string;
  max: string;
}

const EMPTY_FIELD: FieldDraft = {
  label: "",
  type: "text",
  required: false,
  options: "",
  min: "",
  max: "",
};

function toDrafts(fields: TemplateFieldInput[]): FieldDraft[] {
  return fields.map((f) => ({
    label: f.label,
    type: f.type,
    required: Boolean(f.required),
    options: (f.options ?? []).join(", "),
    min: f.min !== undefined ? String(f.min) : "",
    max: f.max !== undefined ? String(f.max) : "",
  }));
}

export function TemplatesSection({
  templates,
  services,
  canEdit,
}: {
  templates: TemplateRow[];
  services: { id: string; label: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null); // "new" | templateId
  const [name, setName] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [fields, setFields] = useState<FieldDraft[]>([{ ...EMPTY_FIELD }]);
  const [error, setError] = useState<string | null>(null);

  function openNew() {
    setName("");
    setServiceId("");
    setFields([{ ...EMPTY_FIELD }]);
    setError(null);
    setEditing("new");
  }

  function openEdit(t: TemplateRow) {
    setName(t.name);
    setServiceId(t.serviceId ?? "");
    setFields(t.fields.length ? toDrafts(t.fields) : [{ ...EMPTY_FIELD }]);
    setError(null);
    setEditing(t.templateId);
  }

  function setField(i: number, patch: Partial<FieldDraft>) {
    setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  function buildPayload() {
    return {
      name,
      serviceId: serviceId || undefined,
      fields: fields
        .filter((f) => f.label.trim())
        .map((f) => ({
          key: slugify(f.label),
          label: f.label.trim(),
          type: f.type,
          required: f.required || undefined,
          options:
            f.type === "select"
              ? f.options.split(",").map((o) => o.trim()).filter(Boolean)
              : undefined,
          min: f.min !== "" ? Number(f.min) : undefined,
          max: f.max !== "" ? Number(f.max) : undefined,
        })),
    };
  }

  function submit() {
    setError(null);
    const payload = buildPayload();
    startTransition(async () => {
      const res =
        editing === "new"
          ? await createTemplateAction(payload)
          : await publishTemplateVersionAction(editing!, payload);
      if (res.ok) {
        setEditing(null);
        router.refresh();
      } else {
        setError(res.error ?? "Could not save template.");
      }
    });
  }

  function remove(t: TemplateRow) {
    if (
      !window.confirm(
        `Delete template "${t.name}"? Templates already used by encounters cannot be deleted.`,
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await deleteTemplateAction(t.templateId);
      if (res.ok) router.refresh();
      else setError(res.error ?? "Could not delete template.");
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Note forms used in encounters. Linking a template to a service
        auto-attaches it when starting an encounter from an appointment.
        Editing publishes a new version; existing notes keep theirs.
      </p>

      <ul className="divide-y divide-border rounded-md border border-border">
        {templates.length === 0 && (
          <li className="p-3 text-sm text-muted">No templates yet.</li>
        )}
        {templates.map((t) => (
          <li key={t.templateId} className="flex items-center justify-between p-3 text-sm">
            <div>
              <div className="font-medium">
                {t.name}{" "}
                <span className="text-xs text-muted">
                  v{t.version ?? "—"} · {t.fields.length} field
                  {t.fields.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="text-xs text-muted">
                {t.serviceName ? `Linked to ${t.serviceName}` : "Not linked to a service"}
                {t.usageCount > 0 ? ` · used by ${t.usageCount} encounter${t.usageCount === 1 ? "" : "s"}` : ""}
              </div>
            </div>
            {canEdit && (
              <span className="flex gap-1.5">
                <button onClick={() => openEdit(t)} className={editBtnClass}>
                  Edit
                </button>
                <button
                  onClick={() => remove(t)}
                  disabled={pending}
                  className={deleteBtnClass}
                >
                  Delete
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {error && editing === null && <p className="text-sm text-danger">{error}</p>}

      {canEdit && editing === null && (
        <Button variant="secondary" onClick={openNew}>
          Add template
        </Button>
      )}

      {canEdit && editing !== null && (
        <div className="space-y-4 rounded-md border border-border p-4">
          <div className="text-sm font-semibold">
            {editing === "new" ? "New template" : "Edit template (publishes a new version)"}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Template name</span>
              <input
                className={inputClass}
                placeholder="Coaching Session Note"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Linked service (auto-attach)</span>
              <select
                className={inputClass}
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
              >
                <option value="">None</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Fields</div>
            {fields.map((f, i) => (
              <div
                key={i}
                className="flex flex-wrap items-end gap-2 rounded-md bg-background p-2"
              >
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs">
                  <span>Label</span>
                  <input
                    className={inputClass}
                    placeholder="Chief complaint"
                    value={f.label}
                    onChange={(e) => setField(i, { label: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span>Type</span>
                  <select
                    className={inputClass}
                    value={f.type}
                    onChange={(e) =>
                      setField(i, { type: e.target.value as FieldDraft["type"] })
                    }
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                {f.type === "select" && (
                  <label className="flex min-w-44 flex-col gap-1 text-xs">
                    <span>Options (comma-separated)</span>
                    <input
                      className={inputClass}
                      placeholder="good, neutral, low"
                      value={f.options}
                      onChange={(e) => setField(i, { options: e.target.value })}
                    />
                  </label>
                )}
                {(f.type === "scale" || f.type === "number") && (
                  <>
                    <label className="flex w-16 flex-col gap-1 text-xs">
                      <span>Min</span>
                      <input
                        type="number"
                        className={inputClass}
                        value={f.min}
                        onChange={(e) => setField(i, { min: e.target.value })}
                      />
                    </label>
                    <label className="flex w-16 flex-col gap-1 text-xs">
                      <span>Max</span>
                      <input
                        type="number"
                        className={inputClass}
                        value={f.max}
                        onChange={(e) => setField(i, { max: e.target.value })}
                      />
                    </label>
                  </>
                )}
                <label className="flex items-center gap-1.5 pb-2 text-xs">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => setField(i, { required: e.target.checked })}
                  />
                  Required
                </label>
                <button
                  onClick={() =>
                    setFields((fs) => fs.filter((_, idx) => idx !== i))
                  }
                  disabled={fields.length === 1}
                  className={`${deleteBtnClass} mb-1 disabled:opacity-40`}
                  aria-label="Remove field"
                >
                  Remove
                </button>
              </div>
            ))}
            <Button
              variant="ghost"
              onClick={() => setFields((fs) => [...fs, { ...EMPTY_FIELD }])}
            >
              + Add field
            </Button>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button
              onClick={submit}
              disabled={pending || !name.trim() || !fields.some((f) => f.label.trim())}
            >
              {pending
                ? "Saving…"
                : editing === "new"
                  ? "Create template"
                  : "Publish new version"}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
