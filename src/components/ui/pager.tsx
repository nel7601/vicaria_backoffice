import Link from "next/link";

/** Prev/next pager shared by the list views (server component). */
export function Pager({
  page,
  total,
  pageSize,
  hrefFor,
}: {
  page: number;
  total: number;
  pageSize: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-sm">
      <span className="text-muted">
        Page {page} of {pages} · {total} result{total === 1 ? "" : "s"}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link
            href={hrefFor(page - 1)}
            className="rounded-md border border-border px-3 py-1 hover:bg-warm"
          >
            ← Prev
          </Link>
        ) : (
          <span className="rounded-md border border-border px-3 py-1 opacity-40">
            ← Prev
          </span>
        )}
        {page < pages ? (
          <Link
            href={hrefFor(page + 1)}
            className="rounded-md border border-border px-3 py-1 hover:bg-warm"
          >
            Next →
          </Link>
        ) : (
          <span className="rounded-md border border-border px-3 py-1 opacity-40">
            Next →
          </span>
        )}
      </div>
    </div>
  );
}
