import type * as React from "react";

/**
 * Building blocks shared by the printable documents (invoice, receipt).
 *
 * These render a sheet of paper, not an app screen: white ground, black type,
 * no cards or shadows. What the clinic hands a patient should look the same
 * whether it came off the printer or was saved as a PDF, so the layout is
 * sized in millimetres of a Letter page and everything interactive carries
 * `print:hidden`.
 */

export interface CompanyIdentity {
  legalName: string;
  operatingName?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
}

/** The page itself: a centred sheet on screen, the bare page when printed. */
export function DocumentSheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="print-document mx-auto w-full max-w-[210mm] bg-white p-8 text-[13px] leading-relaxed text-black shadow-card print:max-w-none print:p-0 print:shadow-none">
      {children}
    </div>
  );
}

/** Vicaria's letterhead on the left, the document's identity on the right. */
export function DocumentHeader({
  company,
  title,
  meta,
}: {
  company: CompanyIdentity;
  title: string;
  meta: { label: string; value: string }[];
}) {
  return (
    <header className="print-keep-together flex flex-wrap items-start justify-between gap-6 border-b-2 border-black pb-4">
      <div>
        <div className="font-serif text-xl font-bold tracking-tight">
          {company.operatingName || company.legalName}
        </div>
        {company.operatingName && company.operatingName !== company.legalName && (
          <div className="text-[11px] text-neutral-600">{company.legalName}</div>
        )}
        <address className="mt-1 whitespace-pre-line text-[11px] not-italic text-neutral-700">
          {[company.address, company.phone, company.email, company.website]
            .filter(Boolean)
            .join("\n")}
        </address>
      </div>
      <div className="text-right">
        <h1 className="font-serif text-lg font-bold uppercase tracking-widest">
          {title}
        </h1>
        <dl className="mt-2 space-y-0.5 text-[11px]">
          {meta.map((m) => (
            <div key={m.label} className="flex justify-end gap-2">
              <dt className="text-neutral-600">{m.label}:</dt>
              <dd className="font-medium tabular-nums">{m.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </header>
  );
}

/** A named block of details — "Bill to", "Patient" — one per column. */
export function PartyBlock({
  title,
  lines,
}: {
  title: string;
  lines: (string | null | undefined)[];
}) {
  const visible = lines.filter((l): l is string => Boolean(l && l.trim()));
  return (
    <div className="print-keep-together">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600">
        {title}
      </div>
      <div className="mt-1 whitespace-pre-line">
        {visible.length > 0 ? visible.join("\n") : "—"}
      </div>
    </div>
  );
}

/** One line of a labelled field, as the paper forms lay them out. */
export function FieldLine({
  label,
  value,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex gap-2 border-b border-neutral-300 py-1.5 ${className}`}>
      <span className="shrink-0 text-neutral-600">{label}:</span>
      <span className="min-w-0 flex-1 font-medium">{value}</span>
    </div>
  );
}

/**
 * A tick box, printed as ☒/☐ rather than a coloured background, so it reads
 * correctly even when the browser drops background graphics.
 */
export function TickBox({
  checked,
  label,
}: {
  checked: boolean;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span aria-hidden="true" className="text-base leading-none">
        {checked ? "☒" : "☐"}
      </span>
      <span className={checked ? "font-semibold" : "text-neutral-600"}>
        {label}
      </span>
      <span className="sr-only">{checked ? " (selected)" : ""}</span>
    </span>
  );
}

/** Ruled line for a hand signature. */
export function SignatureLine({
  label,
  hint,
}: {
  label: string;
  hint?: string;
}) {
  return (
    <div className="print-keep-together">
      <div className="mt-8 border-b border-black" />
      <div className="mt-1 text-[11px] text-neutral-700">{label}</div>
      {hint && <div className="text-[10px] text-neutral-500">{hint}</div>}
    </div>
  );
}
