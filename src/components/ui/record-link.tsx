import Link from "next/link";

/**
 * Small file-icon button that opens a patient's clinical record. Placed next
 * to the patient name wherever it appears.
 */
export function RecordLink({
  patientId,
  className = "",
}: {
  patientId: string;
  className?: string;
}) {
  return (
    <Link
      href={`/patients/${patientId}/record`}
      title="Clinical record"
      aria-label="Clinical record"
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border text-muted hover:border-primary/40 hover:bg-primary/10 hover:text-primary align-text-bottom ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3 w-3"
        aria-hidden="true"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M9 13h6" />
        <path d="M9 17h6" />
      </svg>
    </Link>
  );
}
