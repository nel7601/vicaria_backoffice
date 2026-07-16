"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { exportReportAction } from "../actions";

export function ExportButton({
  code,
  from,
  to,
}: {
  code: string;
  from?: string;
  to?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function download() {
    setError(null);
    startTransition(async () => {
      const res = await exportReportAction(code, { from, to });
      if (!res.ok || !res.csv) {
        setError(res.error ?? "Export failed.");
        return;
      }
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename ?? `${code}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <span className="flex items-center gap-2">
      <Button variant="secondary" onClick={download} disabled={pending}>
        {pending ? "Exporting…" : "Export CSV"}
      </Button>
      {error && <span className="text-sm text-danger">{error}</span>}
    </span>
  );
}
