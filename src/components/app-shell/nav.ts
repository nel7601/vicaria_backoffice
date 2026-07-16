import type { Resource } from "@/lib/auth/rbac";

/**
 * Primary navigation — the nine backoffice views (spec §7).
 * Each item declares the resource it reads so the shell can hide items a role
 * cannot access (defence-in-depth; real enforcement is server + RLS).
 */
export interface NavItem {
  href: string;
  label: string;
  /** Resource gating visibility; undefined = always visible when signed in. */
  resource?: Resource;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/patients", label: "Patients", resource: "patients_demographic" },
  { href: "/calendar", label: "Calendar", resource: "patients_demographic" },
  { href: "/encounters", label: "Encounters", resource: "clinical_notes" },
  { href: "/billing", label: "Billing", resource: "invoices_payments" },
  { href: "/reports", label: "Reports", resource: "clinical_reports" },
  { href: "/settings", label: "Settings", resource: "configuration" },
];
