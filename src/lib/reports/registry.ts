import type { Resource, Role } from "@/lib/auth/rbac";
import { can } from "@/lib/auth/rbac";

/**
 * Report catalog (spec §11). Each report declares the resource it reads so the
 * catalog only offers reports a role may run. Marketing reports are aggregated
 * and privacy-suppressed (§11.1).
 */
export interface ReportDef {
  code: string;
  title: string;
  category: "Financial" | "Operational" | "Clinical" | "Packages" | "Marketing";
  resource: Resource;
  description: string;
  /** true when output is aggregated/suppressed (marketing privacy, §11.1). */
  aggregated?: boolean;
}

export const REPORTS: ReportDef[] = [
  {
    code: "FIN-01",
    title: "Revenue by period",
    category: "Financial",
    resource: "invoices_payments",
    description: "Confirmed payments totalled by day within a date range.",
  },
  {
    code: "FIN-02",
    title: "Outstanding balances (aging)",
    category: "Financial",
    resource: "invoices_payments",
    description: "Open invoice balances bucketed 0-30 / 31-60 / 61-90 / 90+.",
  },
  {
    code: "FIN-03",
    title: "Payment methods",
    category: "Financial",
    resource: "invoices_payments",
    description: "Confirmed payment totals by method.",
  },
  {
    code: "OPS-01",
    title: "Appointments",
    category: "Operational",
    resource: "patients_demographic",
    description: "Appointment counts by status within a date range.",
  },
  {
    code: "CLN-01",
    title: "Follow-up due",
    category: "Clinical",
    resource: "clinical_reports",
    description: "Open follow-up tasks past or near their due date.",
  },
  {
    code: "CLN-03",
    title: "Unsigned notes",
    category: "Clinical",
    resource: "clinical_reports",
    description: "Draft encounters pending signature, by practitioner.",
  },
  {
    code: "PKG-01",
    title: "Package liability",
    category: "Packages",
    resource: "invoices_payments",
    description: "Sessions sold, used and outstanding per enrollment.",
  },
  {
    code: "MKT-01",
    title: "Acquisition source",
    category: "Marketing",
    resource: "marketing_reports",
    description: "New patients by acquisition source (aggregated, suppressed).",
    aggregated: true,
  },
];

export function reportsForRoles(roles: Role[]): ReportDef[] {
  return REPORTS.filter((r) => can(roles, r.resource, "read"));
}

export function getReport(code: string): ReportDef | undefined {
  return REPORTS.find((r) => r.code === code);
}
