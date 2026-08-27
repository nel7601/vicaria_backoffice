"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/domain/money";
import {
  cancelTerminalPaymentAction,
  checkTerminalPaymentAction,
  payTerminalAction,
} from "../actions";

const POLL_MS = 3000;

/**
 * Card-present payment on the Square Terminal (POS): pushes the invoice
 * balance to the device, then polls until the patient pays (or the checkout
 * is cancelled / times out on the device). The webhook settles too — polling
 * and webhook race safely, whichever lands first applies the payment.
 *
 * `pendingPaymentId` resumes watching a checkout that was already pushed
 * (e.g. the page was reloaded while the patient was paying).
 */
export function TerminalPayment({
  invoiceId,
  amountCents,
  pendingPaymentId = null,
}: {
  invoiceId: string;
  amountCents: number;
  pendingPaymentId?: string | null;
}) {
  const router = useRouter();
  const [paymentId, setPaymentId] = useState<string | null>(pendingPaymentId);
  const [waiting, setWaiting] = useState(pendingPaymentId !== null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const settle = useCallback(
    (status: string | undefined) => {
      setWaiting(false);
      setPaymentId(null);
      if (status === "confirmed") {
        setMessage("Paid on the terminal — payment applied and receipt issued.");
      } else if (status === "cancelled") {
        setMessage("The terminal checkout was cancelled.");
      } else {
        setMessage("The terminal payment did not complete.");
      }
      router.refresh();
    },
    [router],
  );

  useEffect(() => {
    if (!waiting || !paymentId) return;
    let active = true;

    const tick = async () => {
      try {
        const res = await checkTerminalPaymentAction(paymentId);
        if (!active) return;
        if (res.ok && res.status && res.status !== "pending") {
          settle(res.status);
          return;
        }
        if (!res.ok && res.error) setMessage(res.error);
      } catch {
        // Transient network error — keep polling.
      }
      if (active) timerRef.current = setTimeout(tick, POLL_MS);
    };

    timerRef.current = setTimeout(tick, POLL_MS);
    return () => {
      active = false;
      stopPolling();
    };
  }, [waiting, paymentId, settle, stopPolling]);

  async function sendToTerminal() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await payTerminalAction(invoiceId);
      if (res.ok && res.id) {
        setPaymentId(res.id);
        setWaiting(true);
        setMessage(null);
      } else {
        setMessage(res.error ?? "Could not reach the terminal.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!paymentId) return;
    setBusy(true);
    try {
      const res = await cancelTerminalPaymentAction(paymentId);
      if (res.ok && res.status && res.status !== "pending") {
        settle(res.status);
      } else if (!res.ok) {
        setMessage(res.error ?? "Could not cancel the checkout.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (waiting) {
    return (
      <div className="mt-3 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
          Waiting for the patient to pay {formatCents(amountCents)} on the
          terminal…
        </div>
        <Button variant="secondary" disabled={busy} onClick={cancel}>
          Cancel on terminal
        </Button>
        {message && <p className="text-sm text-muted">{message}</p>}
        <p className="text-xs text-muted">
          The invoice is applied and the receipt issued automatically as soon
          as the terminal confirms the payment.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <Button disabled={busy} onClick={sendToTerminal}>
        {busy ? "Sending…" : `Send ${formatCents(amountCents)} to terminal`}
      </Button>
      {message && <p className="text-sm text-muted">{message}</p>}
      <p className="text-xs text-muted">
        The amount appears on the Square Terminal; the patient taps or inserts
        their card there.
      </p>
    </div>
  );
}
