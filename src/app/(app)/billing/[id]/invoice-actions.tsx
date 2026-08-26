"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { formatCents } from "@/lib/domain/money";
import {
  allocatePaymentAction,
  creditNoteAction,
  generateReceiptAction,
  issueInvoiceAction,
  payInvoiceAction,
  verifyEtransferAction,
  voidInvoiceAction,
} from "../actions";

export interface PendingEtransfer {
  id: string;
  amountCents: number;
  etransferSenderName: string | null;
  reference: string | null;
}

/**
 * Guided billing flow (spec §7.1/§13):
 *   pre-invoice (draft) → Confirm & issue → Pay (method) → receipt.
 * Cash confirms/applies/receipts in one step; e-transfer waits for Verify
 * (then auto-applies); card via Square is prepared but not enabled yet.
 */
export function InvoiceActions({
  invoiceId,
  status,
  balanceCents,
  allocatable,
  pendingEtransfers,
}: {
  invoiceId: string;
  status: string;
  balanceCents: number;
  allocatable: { id: string; method: string; remainingCents: number }[];
  pendingEtransfers: PendingEtransfer[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [method, setMethod] = useState<"cash" | "e_transfer" | "square_card">(
    "cash",
  );
  const [senderName, setSenderName] = useState("");
  const [reference, setReference] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [paymentId, setPaymentId] = useState("");
  const [allocAmount, setAllocAmount] = useState("");

  const isDraft = status === "draft";
  const isOpen = ["issued", "partially_paid", "overdue"].includes(status);
  const hasBalance = balanceCents > 0;

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg?: string,
  ) {
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      setMessage(res.ok ? (okMsg ?? "Done.") : (res.error ?? "Failed."));
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* Step 1 — pre-invoice review & confirmation */}
      {isDraft && (
        <div className="rounded-md border border-border bg-warm/50 p-4">
          <p className="text-sm">
            This is a <strong>pre-invoice</strong>. Review the line items above;
            confirming assigns the official invoice number and freezes it.
          </p>
          <Button
            className="mt-3"
            disabled={pending}
            onClick={() =>
              run(() => issueInvoiceAction(invoiceId), "Invoice confirmed and issued.")
            }
          >
            Confirm &amp; issue invoice
          </Button>
        </div>
      )}

      {/* Pending e-transfers awaiting bank verification */}
      {pendingEtransfers.length > 0 && (
        <div className="rounded-md border border-ring/40 bg-ring/5 p-4">
          <div className="text-sm font-medium">E-transfer awaiting verification</div>
          <ul className="mt-2 space-y-2">
            {pendingEtransfers.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span>
                  {formatCents(p.amountCents)}
                  {p.etransferSenderName ? ` · from ${p.etransferSenderName}` : ""}
                  {p.reference ? ` · ref ${p.reference}` : ""}
                </span>
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => verifyEtransferAction(p.id),
                      "E-transfer verified — payment applied and receipt issued.",
                    )
                  }
                >
                  Verify &amp; apply
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            Verify once the transfer shows up in the bank account. The payment
            is then applied to this invoice and the receipt is issued.
          </p>
        </div>
      )}

      {/* Step 2 — pay */}
      {isOpen && hasBalance && pendingEtransfers.length === 0 && (
        <div className="rounded-md border border-border p-4">
          <div className="text-sm font-semibold">
            Pay {formatCents(balanceCents)}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                { value: "cash", label: "Cash" },
                { value: "e_transfer", label: "e-Transfer" },
                { value: "square_card", label: "Card (Square)" },
              ] as const
            ).map((m) => (
              <button
                key={m.value}
                onClick={() => setMethod(m.value)}
                disabled={m.value === "square_card"}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                  method === m.value
                    ? "border-primary bg-primary-soft text-primary-hover"
                    : "border-border hover:bg-warm"
                } ${m.value === "square_card" ? "cursor-not-allowed opacity-50" : ""}`}
              >
                {m.label}
                {m.value === "square_card" && (
                  <span className="ml-1 text-xs text-muted">coming soon</span>
                )}
              </button>
            ))}
          </div>

          {method === "e_transfer" && (
            <div className="mt-3 flex flex-wrap gap-2">
              <label className="flex min-w-48 flex-col gap-1 text-xs">
                <span className="font-medium">Sender name</span>
                <input
                  className={inputClass}
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                />
              </label>
              <label className="flex min-w-40 flex-col gap-1 text-xs">
                <span className="font-medium">Reference (optional)</span>
                <input
                  className={inputClass}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
            </div>
          )}

          <Button
            className="mt-3"
            disabled={pending || method === "square_card"}
            onClick={() =>
              run(
                () =>
                  payInvoiceAction(invoiceId, {
                    method,
                    etransferSenderName: senderName,
                    reference,
                  }),
                method === "cash"
                  ? "Paid — receipt issued."
                  : "E-transfer registered — verify it once it arrives.",
              )
            }
          >
            {pending ? "Processing…" : "Confirm payment"}
          </Button>
          {method === "e_transfer" && (
            <p className="mt-2 text-xs text-muted">
              The invoice stays open until the transfer is verified; it is then
              applied automatically.
            </p>
          )}
        </div>
      )}

      {isOpen && !hasBalance && (
        <p className="text-sm text-success">
          Paid in full — the receipt is available below.
        </p>
      )}

      {/* Advanced / exceptional operations */}
      {isOpen && (
        <div>
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs text-muted underline-offset-2 hover:underline"
          >
            {showAdvanced ? "Hide advanced actions" : "Advanced actions…"}
          </button>
          {showAdvanced && (
            <div className="mt-3 space-y-4 rounded-md border border-border p-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    run(() => generateReceiptAction(invoiceId), "Receipt generated.")
                  }
                >
                  Generate receipt
                </Button>
                <Button
                  variant="danger"
                  disabled={pending}
                  onClick={() => {
                    const reason = window.prompt("Reason to void this invoice:");
                    if (!reason) return;
                    run(
                      () => voidInvoiceAction(invoiceId, { reason }),
                      "Invoice voided.",
                    );
                  }}
                >
                  Void
                </Button>
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    const amount = window.prompt("Credit note amount (CAD):");
                    if (!amount) return;
                    const reason = window.prompt("Reason for the credit note:");
                    if (!reason) return;
                    run(
                      () =>
                        creditNoteAction({
                          invoiceId,
                          amountCents: Math.round(Number(amount) * 100),
                          reason,
                        }),
                      "Credit note issued.",
                    );
                  }}
                >
                  Credit note
                </Button>
              </div>

              {/* Manual allocation of an existing unapplied payment */}
              {hasBalance && allocatable.length > 0 && (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex min-w-52 flex-col gap-1 text-xs">
                    <span className="font-medium">
                      Apply an existing payment
                    </span>
                    <select
                      className={inputClass}
                      value={paymentId}
                      onChange={(e) => setPaymentId(e.target.value)}
                    >
                      <option value="">Select payment…</option>
                      {allocatable.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.method} · {formatCents(p.remainingCents)} available
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex w-28 flex-col gap-1 text-xs">
                    <span className="font-medium">Amount (CAD)</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className={inputClass}
                      value={allocAmount}
                      onChange={(e) => setAllocAmount(e.target.value)}
                    />
                  </label>
                  <Button
                    variant="secondary"
                    disabled={pending || !paymentId || !allocAmount}
                    onClick={() =>
                      run(
                        () =>
                          allocatePaymentAction({
                            paymentId,
                            invoiceId,
                            amountCents: Math.round(Number(allocAmount) * 100),
                          }),
                        "Payment applied.",
                      )
                    }
                  >
                    Apply
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {message && <p className="text-sm text-muted">{message}</p>}
    </div>
  );
}
