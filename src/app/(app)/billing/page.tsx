import { ModulePlaceholder } from "@/components/app-shell/module-placeholder";

export default function BillingPage() {
  return (
    <ModulePlaceholder
      title="Billing"
      phase="Phase 4 — Billing & Square"
      requirements={[
        "FR-INV-001..004 Draft → issue with immutable numbering and bilingual PDF",
        "FR-PAY-001..004 Payments, allocations, e-transfer verification, cash closing",
        "FR-REC-001 Receipts capped at confirmed allocations",
        "FR-REF-001 Refunds and credit notes without deleting originals",
        "§10.1 Square idempotent webhooks and reconciliation",
      ]}
    />
  );
}
