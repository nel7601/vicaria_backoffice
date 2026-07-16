import { ModulePlaceholder } from "@/components/app-shell/module-placeholder";

export default function SettingsPage() {
  return (
    <ModulePlaceholder
      title="Settings"
      phase="Phase 1 — Platform & Administration"
      requirements={[
        "FR-ADM-001 Company and locations (identity, numbering, taxes, legal texts)",
        "FR-ADM-002 Employees and signatures (private storage)",
        "FR-ADM-003 Roles and permissions per location and resource",
        "FR-SVC-001 / FR-PKG-001 Services, prices and packages",
        "Integrations, privacy requests and audit configuration",
      ]}
    />
  );
}
