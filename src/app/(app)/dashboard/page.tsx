import { Card, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";
import { dashboardCounters } from "@/lib/db/queries/clinical";

/**
 * Dashboard (spec §7): KPIs, today's appointments, overdue tasks, unsigned
 * notes, balances and expiring packages. Wired counters activate as their
 * modules ship; remaining tiles fill in during Phases 4–5.
 */
export default async function DashboardPage() {
  await getSessionUser();

  let unsignedNotes = "—";
  let overdueTasks = "—";
  try {
    const org = await getPrimaryOrganization();
    if (org) {
      const c = await dashboardCounters(org.id, new Date());
      unsignedNotes = String(c.unsignedNotes);
      overdueTasks = String(c.overdueTasks);
    }
  } catch {
    // DB not configured in this environment; keep placeholders.
  }

  const kpis = [
    { title: "Today's appointments", value: "—", hint: "Scheduled / completed" },
    { title: "Overdue tasks", value: overdueTasks, hint: "Follow-up due (CLN-01)" },
    { title: "Unsigned notes", value: unsignedNotes, hint: "Drafts pending (CLN-03)" },
    { title: "Outstanding balance", value: "—", hint: "Aging (FIN-02)" },
    { title: "Packages expiring", value: "—", hint: "Next 30 days (PKG-02)" },
    { title: "Cash difference", value: "—", hint: "Today's closing (FIN-05)" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted">
          Daily operating snapshot. Metrics activate as each module ships.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi) => (
          <Card key={kpi.title}>
            <CardTitle>{kpi.title}</CardTitle>
            <div className="mt-2 text-3xl font-semibold tabular-nums">
              {kpi.value}
            </div>
            <div className="mt-1 text-xs text-muted">{kpi.hint}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
