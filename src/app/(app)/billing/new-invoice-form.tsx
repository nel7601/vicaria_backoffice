"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { formatCents } from "@/lib/domain/money";
import { computeInvoiceTotals } from "@/lib/domain/invoice";
import { createInvoiceAction } from "./actions";

interface Line {
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBps: number;
}

const EMPTY_LINE: Line = { description: "", quantity: 1, unitPriceCents: 0, taxRateBps: 0 };

export function NewInvoiceForm({
  patients,
}: {
  patients: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [patientId, setPatientId] = useState("");
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);
  const [error, setError] = useState<string | null>(null);

  const totals = computeInvoiceTotals(lines);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createInvoiceAction({
        patientId,
        language,
        items: lines.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unitPriceCents: Number(l.unitPriceCents),
          taxRateBps: Number(l.taxRateBps),
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
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap gap-3">
        <select
          className={`${inputClass} max-w-72`}
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
        <select
          className={`${inputClass} max-w-28`}
          value={language}
          onChange={(e) => setLanguage(e.target.value as "en" | "es")}
        >
          <option value="en">EN</option>
          <option value="es">ES</option>
        </select>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-muted">
            <th className="pb-1">Description</th>
            <th className="pb-1 w-16">Qty</th>
            <th className="pb-1 w-28">Unit ¢</th>
            <th className="pb-1 w-24">Tax bps</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="pr-2 py-1">
                <input
                  className={inputClass}
                  value={l.description}
                  onChange={(e) => updateLine(i, { description: e.target.value })}
                />
              </td>
              <td className="pr-2 py-1">
                <input
                  type="number"
                  min={1}
                  className={inputClass}
                  value={l.quantity}
                  onChange={(e) => updateLine(i, { quantity: e.target.valueAsNumber || 0 })}
                />
              </td>
              <td className="pr-2 py-1">
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={l.unitPriceCents}
                  onChange={(e) => updateLine(i, { unitPriceCents: e.target.valueAsNumber || 0 })}
                />
              </td>
              <td className="py-1">
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={l.taxRateBps}
                  onChange={(e) => updateLine(i, { taxRateBps: e.target.valueAsNumber || 0 })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => setLines((ls) => [...ls, { ...EMPTY_LINE }])}>
          + Add line
        </Button>
        <div className="text-sm text-muted">
          Subtotal {formatCents(totals.subtotalCents)} · Tax{" "}
          {formatCents(totals.taxCents)} ·{" "}
          <span className="font-semibold text-foreground">
            Total {formatCents(totals.totalCents)}
          </span>
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending || !patientId}>
          {pending ? "Creating…" : "Create draft"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
