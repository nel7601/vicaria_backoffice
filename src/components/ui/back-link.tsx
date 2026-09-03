import Link from "next/link";
import { parseReturnTo } from "@/lib/nav/return-to";

/**
 * The way back out of a view.
 *
 * A page reached from several places cannot hardcode one back link: opening
 * the clinical record from a visit and then landing on "← Patients" loses the
 * visit you were in the middle of writing. The link that brought you here
 * passes `?from=`, and this returns there, named after where it goes; with no
 * `from` it falls back to the page's natural parent.
 */
export function BackLink({
  from,
  fallbackHref,
  fallbackLabel,
}: {
  from?: string;
  fallbackHref: string;
  fallbackLabel: string;
}) {
  const target = parseReturnTo(from) ?? {
    href: fallbackHref,
    label: fallbackLabel,
  };
  return (
    <Link
      href={target.href}
      className="text-sm text-primary hover:underline print:hidden"
    >
      ← {target.label}
    </Link>
  );
}
