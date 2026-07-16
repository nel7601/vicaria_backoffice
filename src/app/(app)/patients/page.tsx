import { ModulePlaceholder } from "@/components/app-shell/module-placeholder";

export default function PatientsPage() {
  return (
    <ModulePlaceholder
      title="Patients"
      phase="Phase 2 — Patients & Scheduling"
      requirements={[
        "FR-PAT-001 Unique patient registration with normalization",
        "FR-PAT-002 Duplicate detection by email / phone / name+DOB",
        "FR-PAT-003 Patient 360 consolidated profile with permission-scoped tabs",
        "FR-PAT-004 Versioned consents (care, privacy, communications, marketing)",
        "FR-PAT-006 Critical alerts and administrative tags",
      ]}
    />
  );
}
