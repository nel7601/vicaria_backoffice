"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { formatCents } from "@/lib/domain/money";
import {
  addEncounterLineAction,
  generateInvoiceFromEncounterAction,
  removeEncounterLineAction,
  saveDraftAction,
  signEncounterAction,
} from "../actions";

export interface LineRow {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBps: number;
  lineTotalCents: number;
}

export interface ServiceOption {
  id: string;
  label: string;
  priceCents: number;
  taxRateBps: number;
}

/**
 * Spec §7.1/§8: record what was actually performed, with quantities
 * (e.g. 1 consultation + 5 simple lesions + 1 complex). The invoice
 * originates from these lines, not from the booking.
 */
export function ServicesPerformed({
  encounterId,
  status,
  lines,
  services,
  canEditLines,
  canInvoice,
  summary: initialSummary,
  contentSnapshot,
  contentHash,
}: {
  encounterId: string;
  status: string;
  lines: LineRow[];
  services: ServiceOption[];
  canEditLines: boolean;
  canInvoice: boolean;
  summary: string | null;
  contentSnapshot: Record<string, unknown>;
  contentHash: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [taxPct, setTaxPct] = useState("13");
  const [summary, setSummary] = useState(initialSummary ?? "");
  const [message, setMessage] = useState<string | null>(null);

  const isDraft = status === "draft";

  function saveSummary() {
    setMessage(null);
    startTransition(async () => {
      const res = await saveDraftAction(encounterId, {
        answers: contentSnapshot,
        summary,
      });
      setMessage(res.ok ? "Saved." : (res.error ?? "Save failed."));
      if (res.ok) router.refresh();
    });
  }

  function sign() {
    if (!window.confirm("Sign this encounter? Signed notes are immutable."))
      return;
    setMessage(null);
    startTransition(async () => {
      // Persist the latest summary first, then sign.
      const saved = await saveDraftAction(encounterId, {
        answers: contentSnapshot,
        summary,
      });
      if (!saved.ok) {
        setMessage(saved.error ?? "Save failed.");
        return;
      }
      const res = await signEncounterAction(encounterId);
      setMessage(res.ok ? "Signed." : (res.error ?? "Sign failed."));
      if (res.ok) router.refresh();
    });
  }

  function pickService(id: string) {
    setServiceId(id);
    const svc = services.find((s) => s.id === id);
    if (svc) {
      setDescription(svc.label);
      setPrice((svc.priceCents / 100).toFixed(2));
      setTaxPct((svc.taxRateBps / 100).toString());
    }
  }

  function addLine() {
    setError(null);
    startTransition(async () => {
      const res = await addEncounterLineAction(encounterId, {
        serviceId: serviceId || undefined,
        description,
        quantity: Number(quantity),
        unitPriceCents: Math.round(Number(price || "0") * 100),
        taxRateBps: Math.round(Number(taxPct || "0") * 100),
      });
      if (res.ok) {
        setDescription("");
        setQuantity("1");
        router.refresh();
      } else {
        setError(res.error ?? "Could not add line.");
      }
    });
  }

  function removeLine(lineId: string) {
    setError(null);
    startTransition(async () => {
      const res = await removeEncounterLineAction(encounterId, lineId);
      if (res.ok) router.refresh();
      else setError(res.error ?? "Could not remove line.");
    });
  }

  function invoice() {
    setError(null);
    startTransition(async () => {
      const res = await generateInvoiceFromEncounterAction(encounterId);
      if (res.ok && res.invoiceId) {
        router.push(`/billing/${res.invoiceId}`);
      } else {
        setError(res.error ?? "Could not generate the invoice.");
      }
    });
  }

  const total = lines.reduce((sum, l) => sum + l.lineTotalCents, 0);

  return (
    <div className="space-y-4">
      {/* Doctor's description of what was done in this visit */}
      <div>
        <label
          htmlFor="encounter-summary"
          className="text-sm font-medium"
        >
          Summary
        </label>
        {canEditLines ? (
          <textarea
            id="encounter-summary"
            className={`${inputClass} mt-1 min-h-24 w-full`}
            placeholder="Describe the service performed: findings, what was done, indications…"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        ) : (
          <p className="mt-1 whitespace-pre-wrap rounded-md bg-background p-3 text-sm">
            {summary || "—"}
          </p>
        )}
      </div>

      {!isDraft && (
        <div className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">
          <p className="font-medium text-success">Signed note — immutable.</p>
          {contentHash && (
            <p className="mt-1 break-all text-xs text-muted">
              hash: {contentHash}
            </p>
          )}
        </div>
      )}

      <ul className="divide-y divide-border rounded-md border border-border">
        {lines.length === 0 && (
          <li className="p-3 text-sm text-muted">
            No services recorded yet
            {canEditLines ? " — add what was actually performed." : "."}
          </li>
        )}
        {lines.map((l) => (
          <li
            key={l.id}
            className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
          >
            <div>
              <span className="font-medium">{l.description}</span>{" "}
              <span className="text-muted">
                × {l.quantity} @ {formatCents(l.unitPriceCents)}
                {l.taxRateBps > 0 ? ` + ${(l.taxRateBps / 100).toFixed(1)}% tax` : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="tabular-nums font-medium">
                {formatCents(l.lineTotalCents)}
              </span>
              {canEditLines && (
                <button
                  onClick={() => removeLine(l.id)}
                  disabled={pending}
                  className="rounded-md border border-danger/40 px-2 py-0.5 text-xs text-danger hover:bg-danger/10"
                >
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
        {lines.length > 0 && (
          <li className="flex items-center justify-between p-3 text-sm font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatCents(total)}</span>
          </li>
        )}
      </ul>

      {canEditLines && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
          <label className="flex min-w-44 flex-col gap-1 text-xs">
            <span className="font-medium">Service</span>
            <select
              className={inputClass}
              value={serviceId}
              onChange={(e) => pickService(e.target.value)}
            >
              <option value="">Custom…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs">
            <span className="font-medium">Description</span>
            <input
              className={inputClass}
              placeholder="Skin tag removal — simple lesion"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="flex w-16 flex-col gap-1 text-xs">
            <span className="font-medium">Qty</span>
            <input
              type="number"
              min={1}
              className={inputClass}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label className="flex w-24 flex-col gap-1 text-xs">
            <span className="font-medium">Unit (CAD)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className={inputClass}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          <label className="flex w-20 flex-col gap-1 text-xs">
            <span className="font-medium">Tax %</span>
            <input
              type="number"
              min={0}
              step="0.5"
              className={inputClass}
              value={taxPct}
              onChange={(e) => setTaxPct(e.target.value)}
            />
          </label>
          <Button
            variant="secondary"
            onClick={addLine}
            disabled={pending || !description.trim()}
          >
            Add line
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canEditLines && (
          <>
            <Button variant="secondary" onClick={saveSummary} disabled={pending}>
              Save draft
            </Button>
            <Button onClick={sign} disabled={pending}>
              Sign
            </Button>
          </>
        )}
        {canInvoice && lines.length > 0 && status !== "draft" && (
          <Button onClick={invoice} disabled={pending}>
            {pending ? "Generating…" : "Generate invoice from encounter"}
          </Button>
        )}
      </div>
      {canInvoice && lines.length > 0 && status === "draft" && (
        <p className="text-xs text-muted">
          Sign the encounter to enable invoicing from these lines.
        </p>
      )}
      {message && <p className="text-sm text-muted">{message}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
