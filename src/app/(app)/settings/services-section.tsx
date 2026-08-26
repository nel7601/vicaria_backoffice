"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { formatCents } from "@/lib/domain/money";
import {
  createServiceAction,
  deleteServiceAction,
  updateServiceAction,
} from "./actions";

export const editBtnClass =
  "rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-background";
export const deleteBtnClass =
  "rounded-md border border-danger/40 px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger/10";

export interface ServiceRow {
  id: string;
  nameEn: string;
  nameEs: string;
  category: string | null;
  family: string;
  billingUnit: string;
  defaultDurationMinutes: number;
  isActive: boolean;
  priceCents: number | null;
  taxRateBps: number | null;
}

interface FormState {
  nameEn: string;
  nameEs: string;
  category: string;
  family: string;
  billingUnit: string;
  duration: string;
  price: string;
  taxPct: string;
  isActive: boolean;
}

const EMPTY: FormState = {
  nameEn: "",
  nameEs: "",
  category: "",
  family: "clinic",
  billingUnit: "fixed",
  duration: "60",
  price: "",
  taxPct: "13",
  isActive: true,
};

function toForm(s: ServiceRow): FormState {
  return {
    nameEn: s.nameEn,
    nameEs: s.nameEs,
    category: s.category ?? "",
    family: s.family,
    billingUnit: s.billingUnit,
    duration: String(s.defaultDurationMinutes),
    price: s.priceCents !== null ? (s.priceCents / 100).toFixed(2) : "",
    taxPct: s.taxRateBps !== null ? (s.taxRateBps / 100).toString() : "0",
    isActive: s.isActive,
  };
}

export function ServicesSection({
  services,
  categories,
  canEdit,
}: {
  services: ServiceRow[];
  /** Category names from the controlled vocabulary (Settings → Categories). */
  categories: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // null = closed, "new" = creating, otherwise the service id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  function openNew() {
    setForm(EMPTY);
    setError(null);
    setEditing("new");
  }

  function openEdit(s: ServiceRow) {
    setForm(toForm(s));
    setError(null);
    setEditing(s.id);
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function remove(s: ServiceRow) {
    if (
      !window.confirm(
        `Delete service "${s.nameEn}"? If it was ever used, it can only be archived.`,
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await deleteServiceAction(s.id);
      if (res.ok) router.refresh();
      else setError(res.error ?? "Could not delete service.");
    });
  }

  function submit() {
    setError(null);
    const payload = {
      nameEn: form.nameEn,
      nameEs: form.nameEs,
      category: form.category,
      family: form.family,
      billingUnit: form.billingUnit,
      defaultDurationMinutes: Number(form.duration),
      priceCents: Math.round(Number(form.price || "0") * 100),
      taxRateBps: Math.round(Number(form.taxPct || "0") * 100),
    };
    startTransition(async () => {
      const res =
        editing === "new"
          ? await createServiceAction(payload)
          : await updateServiceAction(editing!, {
              ...payload,
              isActive: form.isActive,
            });
      if (res.ok) {
        setEditing(null);
        router.refresh();
      } else {
        setError(res.error ?? "Could not save service.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted">
              <th className="py-2 pr-4">Service (EN)</th>
              <th className="py-2 pr-4">Servicio (ES)</th>
              <th className="py-2 pr-4">Category</th>
              <th className="py-2 pr-4">Family</th>
              <th className="py-2 pr-4">Unit</th>
              <th className="py-2 pr-4">Duration</th>
              <th className="py-2 pr-4">Price</th>
              <th className="py-2 pr-4">Tax</th>
              <th className="py-2 pr-4">Status</th>
              {canEdit && <th className="py-2" />}
            </tr>
          </thead>
          <tbody>
            {services.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 10 : 9} className="py-6 text-center text-muted">
                  No services yet. Create the first one to use it in
                  appointments and invoices.
                </td>
              </tr>
            )}
            {services.map((s) => (
              <tr key={s.id} className="border-b border-border/60">
                <td className="py-2 pr-4 font-medium">{s.nameEn}</td>
                <td className="py-2 pr-4">{s.nameEs}</td>
                <td className="py-2 pr-4 text-muted">{s.category ?? "—"}</td>
                <td className="py-2 pr-4">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      s.family === "home_care"
                        ? "bg-primary-soft text-primary-hover"
                        : s.family === "coaching"
                          ? "bg-warm text-foreground"
                          : "bg-success-soft text-success"
                    }`}
                  >
                    {s.family === "home_care" ? "home care" : s.family}
                  </span>
                </td>
                <td className="py-2 pr-4 text-muted">
                  {s.billingUnit.replace("_", " ")}
                </td>
                <td className="py-2 pr-4">{s.defaultDurationMinutes} min</td>
                <td className="py-2 pr-4 tabular-nums">
                  {s.priceCents !== null ? formatCents(s.priceCents) : "—"}
                </td>
                <td className="py-2 pr-4">
                  {s.taxRateBps !== null ? `${(s.taxRateBps / 100).toFixed(1)}%` : "—"}
                </td>
                <td className="py-2 pr-4">
                  {s.isActive ? (
                    <span className="text-success">active</span>
                  ) : (
                    <span className="text-muted">inactive</span>
                  )}
                </td>
                {canEdit && (
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => openEdit(s)} className={editBtnClass}>
                        Edit
                      </button>
                      <button
                        onClick={() => remove(s)}
                        disabled={pending}
                        className={deleteBtnClass}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && editing === null && (
        <p className="text-sm text-danger">{error}</p>
      )}

      {canEdit && editing === null && (
        <Button variant="secondary" onClick={openNew}>
          Add service
        </Button>
      )}

      {canEdit && editing !== null && (
        <div className="grid grid-cols-1 gap-3 rounded-md border border-border p-4 sm:grid-cols-3">
          <div className="text-sm font-semibold sm:col-span-3">
            {editing === "new" ? "New service" : "Edit service"}
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Name (EN)</span>
            <input
              className={inputClass}
              value={form.nameEn}
              onChange={(e) => set("nameEn", e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Nombre (ES)</span>
            <input
              className={inputClass}
              value={form.nameEs}
              onChange={(e) => set("nameEs", e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Category</span>
            <select
              className={inputClass}
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
            >
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {categories.length === 0 && (
              <span className="text-xs text-muted">
                Define categories in the Categories card above.
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Family</span>
            <select
              className={inputClass}
              value={form.family}
              onChange={(e) => set("family", e.target.value)}
            >
              <option value="clinic">Clinic / Skin Treatment</option>
              <option value="coaching">Health Coaching</option>
              <option value="home_care">Home Care (Vicaria Care)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Billing unit</span>
            <select
              className={inputClass}
              value={form.billingUnit}
              onChange={(e) => set("billingUnit", e.target.value)}
            >
              <option value="fixed">Fixed price</option>
              <option value="per_unit">Per unit / lesion</option>
              <option value="per_hour">Per hour</option>
              <option value="per_session">Per session</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Duration (min)</span>
            <input
              type="number"
              min={5}
              step={5}
              className={inputClass}
              value={form.duration}
              onChange={(e) => set("duration", e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Price (CAD)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className={inputClass}
              placeholder="150.00"
              value={form.price}
              onChange={(e) => set("price", e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Tax (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              step="0.5"
              className={inputClass}
              value={form.taxPct}
              onChange={(e) => set("taxPct", e.target.value)}
            />
          </label>
          {editing !== "new" && (
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => set("isActive", e.target.checked)}
              />
              Active (inactive services stop appearing in new appointments)
            </label>
          )}
          {error && <p className="text-sm text-danger sm:col-span-3">{error}</p>}
          <div className="flex gap-2 sm:col-span-3">
            <Button
              onClick={submit}
              disabled={pending || !form.nameEn || !form.nameEs}
            >
              {pending ? "Saving…" : editing === "new" ? "Create service" : "Save changes"}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
          {editing !== "new" && (
            <p className="text-xs text-muted sm:col-span-3">
              Price changes are versioned: issued invoices keep their original
              amounts (FR-SVC-001).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
