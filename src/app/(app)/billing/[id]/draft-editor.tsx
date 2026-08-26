"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { formatCents } from "@/lib/domain/money";
import { computeInvoiceTotals } from "@/lib/domain/invoice";
import { updateInvoiceDraftAction } from "../actions";

export interface DraftItem {
  serviceId: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBps: number;
}

export interface DraftServiceOption {
  id: string;
  label: string;
  priceCents: number;
  taxRateBps: number;
}

interface Line {
  serviceId: string; // "" = custom line with free description
  description: string;
  quantity: number;
  price: string;
  taxPct: string;
}

function toLine(i: DraftItem): Line {
  return {
    serviceId: i.serviceId ?? "",
    description: i.description,
    quantity: i.quantity,
    price: (i.unitPriceCents / 100).toFixed(2),
    taxPct: (i.taxRateBps / 100).toString(),
  };
}

function lineCents(l: Line) {
  return {
    unitPriceCents: Math.round(Number(l.price || "0") * 100),
    taxRateBps: Math.round(Number(l.taxPct || "0") * 100),
  };
}

/** Inline editor for a pre-invoice — enabled only while status = draft. */
export function DraftEditor({
  invoiceId,
  language: initialLanguage,
  notes: initialNotes,
  items,
  services,
}: {
  invoiceId: string;
  language: "en" | "es";
  notes: string | null;
  items: DraftItem[];
  services: DraftServiceOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [language, setLanguage] = useState<"en" | "es">(initialLanguage);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [lines, setLines] = useState<Line[]>(items.map(toLine));
  const [error, setError] = useState<string | null>(null);

  const totals = computeInvoiceTotals(
    lines.map((l) => ({ quantity: l.quantity, ...lineCents(l) })),
  );

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function pickService(i: number, serviceId: string) {
    if (!serviceId) {
      updateLine(i, { serviceId: "" });
      return;
    }
    const svc = services.find((s) => s.id === serviceId);
    updateLine(i, {
      serviceId,
      description: svc?.label ?? "",
      price: svc ? (svc.priceCents / 100).toFixed(2) : "",
      taxPct: svc ? (svc.taxRateBps / 100).toString() : "0",
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateInvoiceDraftAction(invoiceId, {
        language,
        notes,
        items: lines
          .filter((l) => l.description.trim())
          .map((l) => ({
            serviceId: l.serviceId || undefined,
            description: l.description,
            quantity: Number(l.quantity),
            ...lineCents(l),
          })),
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError(res.error ?? "Could not save the pre-invoice.");
      }
    });
  }

  if (!editing) {
    return (
      <Button variant="secondary" onClick={() => setEditing(true)}>
        Edit pre-invoice
      </Button>
    );
  }

  return (
    <div className="w-full space-y-4 rounded-2xl border border-border p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Edit pre-invoice</span>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Language</span>
          <select
            className={inputClass}
            value={language}
            onChange={(e) => setLanguage(e.target.value as "en" | "es")}
          >
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-muted">
              <th className="pb-1">Service / description</th>
              <th className="w-20 pb-1">Qty</th>
              <th className="w-28 pb-1">Unit (CAD)</th>
              <th className="w-24 pb-1">Tax %</th>
              <th className="w-28 pb-1 text-right">Line total</th>
              <th className="w-10 pb-1" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const { unitPriceCents, taxRateBps } = lineCents(l);
              const net = l.quantity * unitPriceCents;
              const total = net + Math.round((net * taxRateBps) / 10000);
              return (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <div className="flex flex-col gap-1">
                      <select
                        className={inputClass}
                        value={l.serviceId}
                        onChange={(e) => pickService(i, e.target.value)}
                      >
                        <option value="">Custom…</option>
                        {services.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label} — {formatCents(s.priceCents)}
                          </option>
                        ))}
                      </select>
                      {!l.serviceId && (
                        <input
                          className={inputClass}
                          placeholder="Line description"
                          value={l.description}
                          onChange={(e) =>
                            updateLine(i, { description: e.target.value })
                          }
                        />
                      )}
                    </div>
                  </td>
                  <td className="py-1 pr-2 align-top">
                    <input
                      type="number"
                      min={1}
                      className={inputClass}
                      value={l.quantity}
                      onChange={(e) =>
                        updateLine(i, { quantity: e.target.valueAsNumber || 1 })
                      }
                    />
                  </td>
                  <td className="py-1 pr-2 align-top">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className={inputClass}
                      value={l.price}
                      onChange={(e) => updateLine(i, { price: e.target.value })}
                    />
                  </td>
                  <td className="py-1 pr-2 align-top">
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      className={inputClass}
                      value={l.taxPct}
                      onChange={(e) => updateLine(i, { taxPct: e.target.value })}
                    />
                  </td>
                  <td className="py-1 text-right align-top tabular-nums">
                    {formatCents(total)}
                  </td>
                  <td className="py-1 text-right align-top">
                    <button
                      onClick={() =>
                        setLines((ls) => ls.filter((_, idx) => idx !== i))
                      }
                      disabled={lines.length === 1}
                      className="rounded-md border border-danger/40 px-2 py-1 text-xs text-danger hover:bg-danger/10 disabled:opacity-40"
                      aria-label="Remove line"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          onClick={() =>
            setLines((ls) => [
              ...ls,
              { serviceId: "", description: "", quantity: 1, price: "", taxPct: "0" },
            ])
          }
        >
          + Add line
        </Button>
        <div className="text-sm text-muted">
          Subtotal {formatCents(totals.subtotalCents)} · Tax{" "}
          {formatCents(totals.taxCents)} ·{" "}
          <span className="text-base font-semibold text-foreground">
            Total {formatCents(totals.totalCents)}
          </span>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Description (optional)</span>
        <textarea
          className={`${inputClass} min-h-16`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button
          onClick={save}
          disabled={pending || !lines.some((l) => l.description.trim())}
        >
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
