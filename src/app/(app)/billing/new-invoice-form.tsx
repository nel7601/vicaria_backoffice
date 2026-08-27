"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { formatCents } from "@/lib/domain/money";
import { cashDiscountCents, computeInvoiceTotals } from "@/lib/domain/invoice";
import { createInvoiceAction } from "./actions";

export interface InvoiceServiceOption {
  id: string;
  label: string;
  priceCents: number;
  taxRateBps: number;
}

interface Line {
  serviceId: string;
  description: string;
  quantity: number;
  /** Editable dollars string; prefilled from the selected service. */
  price: string;
  /** Editable percent string; prefilled from the selected service. */
  taxPct: string;
}

const EMPTY_LINE: Line = {
  serviceId: "",
  description: "",
  quantity: 1,
  price: "",
  taxPct: "0",
};

function lineCents(l: Line) {
  return {
    unitPriceCents: Math.round(Number(l.price || "0") * 100),
    taxRateBps: Math.round(Number(l.taxPct || "0") * 100),
  };
}

/**
 * Pre-invoice builder: one line per catalog service (price/tax prefilled from
 * the catalog but editable), plus a single general description (spec §11).
 */
export function NewInvoiceForm({
  patients,
  services,
}: {
  patients: { id: string; label: string }[];
  services: InvoiceServiceOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [patientId, setPatientId] = useState("");
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [notes, setNotes] = useState("");
  const [cashDiscount, setCashDiscount] = useState(false);
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);
  const [error, setError] = useState<string | null>(null);

  function lineWithDiscount(l: Line) {
    const c = lineCents(l);
    const gross = l.quantity * c.unitPriceCents;
    return {
      quantity: l.quantity,
      ...c,
      discountCents: cashDiscount ? cashDiscountCents(gross, c.taxRateBps) : 0,
    };
  }

  const totals = computeInvoiceTotals(
    lines.filter((l) => l.serviceId).map(lineWithDiscount),
  );

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function pickService(i: number, serviceId: string) {
    const svc = services.find((s) => s.id === serviceId);
    updateLine(i, {
      serviceId,
      description: svc?.label ?? "",
      price: svc ? (svc.priceCents / 100).toFixed(2) : "",
      taxPct: svc ? (svc.taxRateBps / 100).toString() : "0",
    });
  }

  function submit() {
    setError(null);
    const valid = lines.filter((l) => l.serviceId);
    startTransition(async () => {
      const res = await createInvoiceAction({
        patientId,
        language,
        notes,
        items: valid.map((l) => ({
          serviceId: l.serviceId,
          description: l.description,
          ...lineWithDiscount(l),
        })),
      });
      if (res.ok && res.id) {
        router.push(`/billing/${res.id}`);
      } else {
        setError(res.error ?? "Could not create invoice.");
      }
    });
  }

  if (!open) return <Button onClick={() => setOpen(true)}>New invoice</Button>;

  return (
    <div className="w-full space-y-4 rounded-2xl border border-border bg-surface p-4">
      <div className="text-sm font-semibold">New pre-invoice</div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium">Patient / client</span>
          <select
            className={inputClass}
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
          >
            <option value="">Select patient…</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Language</span>
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

      {/* Service lines */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-muted">
              <th className="pb-1">Service</th>
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
                    <select
                      className={inputClass}
                      value={l.serviceId}
                      onChange={(e) => pickService(i, e.target.value)}
                    >
                      <option value="">Select service…</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label} — {formatCents(s.priceCents)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
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
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className={inputClass}
                      value={l.price}
                      onChange={(e) => updateLine(i, { price: e.target.value })}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      className={inputClass}
                      value={l.taxPct}
                      onChange={(e) => updateLine(i, { taxPct: e.target.value })}
                    />
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {l.serviceId ? formatCents(total) : "—"}
                  </td>
                  <td className="py-1 text-right">
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
          onClick={() => setLines((ls) => [...ls, { ...EMPTY_LINE }])}
        >
          + Add line
        </Button>
        <div className="text-sm text-muted">
          Subtotal {formatCents(totals.subtotalCents)}
          {totals.discountCents > 0 && (
            <> · Discount −{formatCents(totals.discountCents)}</>
          )}{" "}
          · Tax {formatCents(totals.taxCents)} ·{" "}
          <span className="text-base font-semibold text-foreground">
            Total {formatCents(totals.totalCents)}
          </span>
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={cashDiscount}
          onChange={(e) => setCashDiscount(e.target.checked)}
        />
        <span>
          <span className="font-medium">Cash discount (tax-equivalent)</span>{" "}
          <span className="text-muted">
            — discounts the taxable base so the total equals the pre-tax
            price; HST is still charged and remitted on the discounted base.
          </span>
        </span>
      </label>

      {/* One general description for the whole invoice */}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Description (optional)</span>
        <textarea
          className={`${inputClass} min-h-16`}
          placeholder="General note shown on the invoice…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button
          onClick={submit}
          disabled={pending || !patientId || !lines.some((l) => l.serviceId)}
        >
          {pending ? "Creating…" : "Create pre-invoice"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
