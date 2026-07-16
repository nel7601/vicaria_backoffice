import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { reportsForRoles, type ReportDef } from "@/lib/reports/registry";

export default async function ReportsPage() {
  const user = await getSessionUser();
  const reports = reportsForRoles(user?.roles ?? []);

  if (reports.length === 0) {
    return (
      <Card>
        <CardTitle>Reports</CardTitle>
        <p className="mt-2 text-sm text-muted">
          Your role has no reports available.
        </p>
      </Card>
    );
  }

  const byCategory = reports.reduce<Record<string, ReportDef[]>>((acc, r) => {
    (acc[r.category] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="text-sm text-muted">
          Prioritized reports with CSV export. Sensitive exports are audited
          (§10.3); marketing reports are aggregated and privacy-suppressed
          (§11.1).
        </p>
      </div>

      {Object.entries(byCategory).map(([category, defs]) => (
        <Card key={category}>
          <CardTitle>{category}</CardTitle>
          <ul className="mt-3 divide-y divide-border text-sm">
            {defs.map((r) => (
              <li key={r.code} className="flex items-center justify-between py-3">
                <div>
                  <Link
                    href={`/reports/${r.code}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {r.code} · {r.title}
                  </Link>
                  <div className="text-xs text-muted">{r.description}</div>
                </div>
                {r.aggregated && (
                  <span className="rounded-full bg-border px-2 py-0.5 text-xs text-muted">
                    aggregated
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
