import type { Resource } from "@/lib/auth/rbac";

/**
 * Primary navigation, grouped by service line (spec §7 + Vicaria Care):
 * clinic services (Vicaria Health), home care (Vicaria Care), and shared
 * operations. Each item declares the resource it reads so the shell can hide
 * items a role cannot access (defence-in-depth; enforcement is server + RLS).
 */
export interface NavItem {
  href: string;
  label: string;
  /** Resource gating visibility; undefined = always visible when signed in. */
  resource?: Resource;
}

export interface NavGroup {
  /** Group heading; null renders items without a heading (top block). */
  label: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ href: "/dashboard", label: "Dashboard" }],
  },
  {
    label: "Vicaria Health",
    items: [
      { href: "/calendar", label: "Calendar", resource: "patients_demographic" },
      { href: "/encounters", label: "Encounters", resource: "clinical_notes" },
    ],
  },
  {
    label: "Vicaria Care",
    items: [
      { href: "/care", label: "Home care", resource: "home_care" },
      { href: "/care/schedule", label: "Care schedule", resource: "home_care" },
    ],
  },
  {
    label: "Shared",
    items: [
      { href: "/patients", label: "Patients", resource: "patients_demographic" },
      { href: "/billing", label: "Billing", resource: "invoices_payments" },
      { href: "/reports", label: "Reports", resource: "clinical_reports" },
      { href: "/settings", label: "Settings", resource: "configuration" },
    ],
  },
];

/** Flat list (permission checks, tests, shells that don't group). */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
