import { ModulePlaceholder } from "@/components/app-shell/module-placeholder";

export default function CalendarPage() {
  return (
    <ModulePlaceholder
      title="Calendar"
      phase="Phase 2 — Patients & Scheduling"
      requirements={[
        "FR-APT-001 Day / week / month views with filters",
        "FR-APT-002 Appointment creation with required fields",
        "FR-APT-003 Practitioner conflict detection (DB exclusion constraint)",
        "FR-APT-004 Status machine with change history",
        "FR-APT-005 Reschedule preserving history and linkage",
      ]}
    />
  );
}
