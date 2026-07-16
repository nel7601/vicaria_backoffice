import { ModulePlaceholder } from "@/components/app-shell/module-placeholder";

export default function EncountersPage() {
  return (
    <ModulePlaceholder
      title="Encounters"
      phase="Phase 3 — Consultations & Treatments"
      requirements={[
        "FR-ENC-002 Dynamic per-service note templates (versioned)",
        "FR-ENC-003 Draft and final signing with hash + timestamp",
        "FR-ENC-004 Immutable signed notes; corrections via amendments",
        "FR-ENC-005 Measurements with type / value / unit",
        "FR-SKIN-001..004 Skin procedures, lesions, photos and consent",
      ]}
    />
  );
}
