import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getReport } from "@/lib/reports/registry";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import { runReport, type ReportResult } from "@/lib/db/queries/reports";
import { ExportButton } from "./export-button";

export default async function ReportViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { code } = await params;
  const { from, to } = await searchParams;
  const def = getReport(code);
  if (!def) notFound();

  const user = await getSessionUser();
  if (!can(user?.roles ?? [], def.resource, "read")) {
    return (
      <Card>
        <CardTitle>{def.title}</CardTitle>
        <p className="mt-2 text-sm text-muted">
          Your role cannot run this report.
        </p>
      </Card>
    );
  }

  let result: ReportResult | null = null;
  let dbError: string | null = null;
  try {
    const org = await getPrimaryOrganization();
    if (org) {
      result = await runReport(code, org.id, {
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      });
    }
  } catch (e) {
    dbError = "Database not reachable. Configure DATABASE_URL and run migrations.";
    console.error("Report run failed:", e);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/reports" className="text-sm text-primary hover:underline">
            ← Reports
          </Link>
          <h1 className="mt-1 text-xl font-semibold">
            {def.code} · {def.title}
          </h1>
          <p className="text-sm text-muted">{def.description}</p>
        </div>
        {!dbError && <ExportButton code={code} from={from} to={to} />}
      </div>

      <Card>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">From</span>
            <input
              type="date"
              name="from"
              defaultValue={from ?? ""}
              className="rounded-md border border-border bg-surface px-3 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">To</span>
            <input
              type="date"
              name="to"
              defaultValue={to ?? ""}
              className="rounded-md border border-border bg-surface px-3 py-1.5"
            />
          </label>
          <button
            type="submit"
            className="rounded-md border border-border px-3 py-1.5 hover:bg-background"
          >
            Apply
          </button>
        </form>

        {dbError && <p className="text-sm text-warning">{dbError}</p>}

        {!dbError && result && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-border-strong text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    {result.columns.map((c) => (
                      <th key={c} className="py-2 pr-4">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={result.columns.length}
                        className="py-6 text-center text-muted"
                      >
                        No data for the selected range.
                      </td>
                    </tr>
                  )}
                  {result.rows.map((row, i) => (
                    <tr key={i} className="border-b border-border/60 transition-colors hover:bg-surface-muted">
                      {row.map((cell, j) => (
                        <td key={j} className="py-2 pr-4 tabular-nums">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.notes && (
              <p className="mt-3 text-xs text-muted">{result.notes}</p>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
