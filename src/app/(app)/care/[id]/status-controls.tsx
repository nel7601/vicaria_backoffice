"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { CareAgreementStatus } from "@/lib/domain/care";
import { changeAgreementStatusAction } from "../actions";

const NEXT: Record<string, { to: CareAgreementStatus; label: string }[]> = {
  draft: [{ to: "active", label: "Activate" }],
  active: [
    { to: "paused", label: "Pause" },
    { to: "ended", label: "End agreement" },
  ],
  paused: [
    { to: "active", label: "Resume" },
    { to: "ended", label: "End agreement" },
  ],
  ended: [],
};

const BADGE: Record<string, string> = {
  draft: "bg-warm text-muted",
  active: "bg-success-soft text-success",
  paused: "bg-primary-soft text-primary-hover",
  ended: "bg-border/60 text-muted",
};

export function AgreementStatusControls({
  agreementId,
  status,
  canEdit,
}: {
  agreementId: string;
  status: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(to: CareAgreementStatus) {
    if (to === "ended" && !window.confirm("End this agreement? This is final."))
      return;
    setError(null);
    startTransition(async () => {
      const res = await changeAgreementStatusAction(agreementId, to);
      if (res.ok) router.refresh();
      else setError(res.error ?? "Could not update status.");
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-3 py-1 text-sm ${BADGE[status] ?? ""}`}>
          {status}
        </span>
        {canEdit &&
          NEXT[status]?.map((n) => (
            <Button
              key={n.to}
              variant={n.to === "ended" ? "danger" : "secondary"}
              onClick={() => change(n.to)}
              disabled={pending}
            >
              {n.label}
            </Button>
          ))}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
