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
  voidInvoiceAction,
} from "../actions";

export function InvoiceActions({
  invoiceId,
  status,
  balanceCents,
  allocatable,
}: {
  invoiceId: string;
  status: string;
  balanceCents: number;
  allocatable: { id: string; method: string; remainingCents: number }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState("");
  const [allocAmount, setAllocAmount] = useState("");

  const isDraft = status === "draft";
  const isOpen = ["issued", "partially_paid", "overdue"].includes(status);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) {
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      setMessage(res.ok ? (okMsg ?? "Done.") : (res.error ?? "Failed."));
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {isDraft && (
          <Button
            disabled={pending}
            onClick={() => run(() => issueInvoiceAction(invoiceId), "Invoice issued.")}
          >
            Issue invoice
          </Button>
        )}
        {isOpen && (
          <>
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
                run(() => voidInvoiceAction(invoiceId, { reason }), "Invoice voided.");
              }}
            >
              Void
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                const reason = window.prompt("Credit note reason:");
                if (!reason) return;
                const amt = window.prompt("Credit amount (cents):");
                if (!amt) return;
                run(
                  () =>
                    creditNoteAction({
                      invoiceId,
                      amountCents: Number(amt),
                      reason,
                    }),
                  "Credit note issued.",
                );
              }}
            >
              Credit note
            </Button>
          </>
        )}
      </div>

      {/* Allocate a confirmed payment */}
      {isOpen && balanceCents > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
          <div className="text-sm text-muted">
            Apply payment (balance {formatCents(balanceCents)}):
          </div>
          <select
            className={`${inputClass} max-w-64`}
            value={paymentId}
            onChange={(e) => setPaymentId(e.target.value)}
          >
            <option value="">Select confirmed payment…</option>
            {allocatable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.method} · {formatCents(p.remainingCents)} available
              </option>
            ))}
          </select>
          <input
            type="number"
            step="0.01"
            placeholder="Amount"
            className={`${inputClass} max-w-28`}
            value={allocAmount}
            onChange={(e) => setAllocAmount(e.target.value)}
          />
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

      {message && <p className="text-sm text-muted">{message}</p>}
    </div>
  );
}
