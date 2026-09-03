"use client";

import Link from "next/link";

/**
 * On-screen controls above a printable document. Hidden on paper.
 *
 * "Save as PDF" is a destination in the browser's own print dialog, so one
 * button covers both: no PDF library to keep in step with this layout.
 */
export function PrintToolbar({
  backHref,
  backLabel,
}: {
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="mx-auto mb-4 flex w-full max-w-[210mm] items-center justify-between gap-4 print:hidden">
      <Link href={backHref} className="text-sm text-primary hover:underline">
        ← {backLabel}
      </Link>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition duration-150 hover:bg-primary-hover"
      >
        Print / Save as PDF
      </button>
    </div>
  );
}
