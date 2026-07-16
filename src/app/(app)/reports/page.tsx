import { ModulePlaceholder } from "@/components/app-shell/module-placeholder";

export default function ReportsPage() {
  return (
    <ModulePlaceholder
      title="Reports"
      phase="Phase 5 — Reporting & Marketing"
      requirements={[
        "FIN-01..05 Revenue, aging, payment methods, reconciliation, cash closing",
        "OPS-01..03 Appointments, utilization, new/returning patients",
        "CLN-01..03 Follow-up due, plans/goals, unsigned notes",
        "PKG-01..02 Package liability and expiring packages",
        "§11.1 Privacy rules: aggregation, small-group suppression, audited exports",
      ]}
    />
  );
}
