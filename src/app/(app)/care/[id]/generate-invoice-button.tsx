"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { generateCareInvoiceAction } from "../actions";

/** Spec §10.4: turn one week's approved hours into a draft invoice. */
export function GenerateInvoiceButton({
  agreementId,
  weekStart,
}: {
  agreementId: string;
  weekStart: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function generate() {
    setError(null);
    startTransition(async () => {
      const res = await generateCareInvoiceAction(agreementId, weekStart);
      if (res.ok && res.id) {
        router.push(`/billing/${res.id}`);
      } else {
        setError(res.error ?? "Could not generate the invoice.");
      }
    });
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <Button variant="secondary" onClick={generate} disabled={pending}>
        {pending ? "Generating…" : "Invoice this week's hours"}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
