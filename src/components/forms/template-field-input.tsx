"use client";

import type { TemplateField } from "@/lib/domain/encounter";
import { Input, inputClass } from "@/components/ui/field";

/** Controlled input for one dynamic template field (text, select, scale…). */
export function TemplateFieldInput({
  field: f,
  value,
  onChange,
  disabled = false,
}: {
  field: TemplateField;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
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
