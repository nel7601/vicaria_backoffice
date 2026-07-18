"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { formatCents } from "@/lib/domain/money";
import { createServiceAction } from "./actions";

export interface ServiceRow {
  id: string;
  nameEn: string;
  nameEs: string;
  category: string | null;
  defaultDurationMinutes: number;
  isActive: boolean;
  priceCents: number | null;
  taxRateBps: number | null;
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
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameEn, setNameEn] = useState("");
  const [nameEs, setNameEs] = useState("");
  const [category, setCategory] = useState("");
  const [duration, setDuration] = useState("60");
  const [price, setPrice] = useState("");
  const [taxPct, setTaxPct] = useState("13");

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createServiceAction({
        nameEn,
        nameEs,
        category,
        defaultDurationMinutes: Number(duration),
        priceCents: Math.round(Number(price || "0") * 100),
        taxRateBps: Math.round(Number(taxPct || "0") * 100),
      });
      if (res.ok) {
        setNameEn("");
        setNameEs("");
        setCategory("");
        setPrice("");
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error ?? "Could not create service.");
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
              <th className="py-2 pr-4">Duration</th>
              <th className="py-2 pr-4">Price</th>
              <th className="py-2 pr-4">Tax</th>
            </tr>
          </thead>
          <tbody>
            {services.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted">
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
                <td className="py-2 pr-4">{s.defaultDurationMinutes} min</td>
                <td className="py-2 pr-4 tabular-nums">
                  {s.priceCents !== null ? formatCents(s.priceCents) : "—"}
                </td>
                <td className="py-2 pr-4">
                  {s.taxRateBps !== null ? `${(s.taxRateBps / 100).toFixed(1)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && !open && (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Add service
        </Button>
      )}

      {canEdit && open && (
        <div className="grid grid-cols-1 gap-3 rounded-md border border-border p-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Name (EN)</span>
            <input className={inputClass} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Nombre (ES)</span>
            <input className={inputClass} value={nameEs} onChange={(e) => setNameEs(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Category</span>
            <select
              className={inputClass}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
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
            <span className="font-medium">Duration (min)</span>
            <input
              type="number"
              min={5}
              step={5}
              className={inputClass}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
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
              value={price}
              onChange={(e) => setPrice(e.target.value)}
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
              value={taxPct}
              onChange={(e) => setTaxPct(e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-danger sm:col-span-3">{error}</p>}
          <div className="flex gap-2 sm:col-span-3">
            <Button onClick={submit} disabled={pending || !nameEn || !nameEs}>
              {pending ? "Saving…" : "Create service"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
