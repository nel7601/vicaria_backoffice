"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { recordPaymentAction, verifyEtransferAction } from "./actions";

export function EtransferVerifyButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await verifyEtransferAction(paymentId);
            if (res.ok) router.refresh();
            else setError(res.error ?? "Failed");
          })
        }
        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-background"
      >
        {pending ? "Verifying…" : "Verify"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}

export function RecordPaymentForm({
  patients,
}: {
  patients: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [patientId, setPatientId] = useState("");
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [sender, setSender] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Record payment
      </Button>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await recordPaymentAction({
        patientId,
        method,
        amountCents: Math.round(Number(amount) * 100),
        reference: reference || undefined,
        etransferSenderName: method === "e_transfer" ? sender || undefined : undefined,
      });
      if (res.ok) {
        setOpen(false);
        setAmount("");
        setReference("");
        setSender("");
        router.refresh();
      } else {
        setError(res.error ?? "Could not record payment.");
      }
    });
  }

  return (
    <div className="flex w-full flex-wrap items-end gap-2 rounded-2xl border border-border bg-surface p-4">
      <select
        className={`${inputClass} max-w-56`}
        value={patientId}
        onChange={(e) => setPatientId(e.target.value)}
      >
        <option value="">Patient…</option>
        {patients.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <select
        className={`${inputClass} max-w-40`}
        value={method}
        onChange={(e) => setMethod(e.target.value)}
      >
        <option value="cash">Cash</option>
        <option value="e_transfer">E-transfer</option>
        <option value="square_card">Square card</option>
        <option value="debit">Debit</option>
        <option value="credit">Credit</option>
        <option value="other">Other</option>
      </select>
      <input
        className={`${inputClass} max-w-28`}
        type="number"
        step="0.01"
        placeholder="Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <input
        className={`${inputClass} max-w-40`}
        placeholder="Reference"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
      />
      {method === "e_transfer" && (
        <input
          className={`${inputClass} max-w-40`}
          placeholder="Sender name"
          value={sender}
          onChange={(e) => setSender(e.target.value)}
        />
      )}
      <Button onClick={submit} disabled={pending || !patientId || !amount}>
        {pending ? "Saving…" : "Save"}
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {error && <p className="w-full text-sm text-danger">{error}</p>}
    </div>
  );
}
