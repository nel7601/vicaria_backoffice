/**
 * Role-Based Access Control (spec §4).
 *
 * This module is the single source of truth for the permission matrix in §4.2.
 * It is enforced at TWO layers (§4 "Regla de mínimo privilegio"):
 *   1. Server authorization (this module, checked in Route Handlers/Actions).
 *   2. PostgreSQL RLS policies (mirrored in migrations).
 * Hiding a UI button is never considered a security control.
 */

export const ROLES = [
  "owner",
  "administrator",
  "practitioner",
  "reception",
  "billing",
  "marketing",
  "auditor",
] as const;

export type Role = (typeof ROLES)[number];

export const RESOURCES = [
  "patients_demographic",
  "clinical_notes",
  "invoices_payments",
  "clinical_reports",
  "marketing_reports",
  "configuration",
  "users_roles",
  "audit",
] as const;

export type Resource = (typeof RESOURCES)[number];

export type Action = "create" | "read" | "update" | "delete";

/**
 * Read scope narrows what rows/fields a read returns:
 * - all: every record in the org
 * - assigned: only records for patients assigned to the user
 * - own: only records authored by the user
 * - limited: reduced field set (no sensitive fields)
 * - aggregate: only aggregated, non-identifiable data (§11.1)
 * - finance: finance-related audit entries only
 * - audited: readable but every access is logged (§12.2)
 * - none: no read access
 */
export type ReadScope =
  | "all"
  | "assigned"
  | "own"
  | "limited"
  | "aggregate"
  | "finance"
  | "audited"
  | "none";

interface Access {
  create: boolean;
  read: ReadScope;
  /** true = full update, "own" = only own records, "partial" = subset, false = none */
  update: boolean | "own" | "partial";
  delete: boolean;
}

const NONE: Access = { create: false, read: "none", update: false, delete: false };

/**
 * Permission matrix — faithful encoding of spec §4.2.
 * Empty cells default to NONE via `resolve()`.
 */
const MATRIX: Record<Role, Partial<Record<Resource, Access>>> = {
  owner: {
    patients_demographic: { create: true, read: "all", update: true, delete: true },
    clinical_notes: { create: false, read: "all", update: false, delete: false },
    invoices_payments: { create: true, read: "all", update: true, delete: true },
    clinical_reports: { create: false, read: "all", update: false, delete: false },
    marketing_reports: { create: false, read: "all", update: false, delete: false },
    configuration: { create: true, read: "all", update: true, delete: true },
    users_roles: { create: true, read: "all", update: true, delete: true },
    audit: { create: false, read: "all", update: false, delete: false },
  },
  administrator: {
    patients_demographic: { create: true, read: "all", update: true, delete: true },
    clinical_notes: { create: false, read: "all", update: false, delete: false },
    invoices_payments: { create: true, read: "all", update: true, delete: true },
    clinical_reports: { create: false, read: "all", update: false, delete: false },
    marketing_reports: { create: false, read: "all", update: false, delete: false },
    configuration: { create: false, read: "all", update: "partial", delete: false },
    users_roles: { create: false, read: "all", update: "partial", delete: false },
    audit: { create: false, read: "limited", update: false, delete: false },
  },
  practitioner: {
    patients_demographic: { create: false, read: "assigned", update: false, delete: false },
    clinical_notes: { create: true, read: "own", update: "own", delete: false },
    invoices_payments: { create: false, read: "limited", update: false, delete: false },
    clinical_reports: { create: false, read: "assigned", update: false, delete: false },
    audit: { create: false, read: "own", update: false, delete: false },
  },
  reception: {
    patients_demographic: { create: true, read: "all", update: true, delete: true },
    invoices_payments: { create: true, read: "all", update: false, delete: false },
  },
  billing: {
    patients_demographic: { create: false, read: "all", update: false, delete: false },
    invoices_payments: { create: true, read: "all", update: true, delete: true },
    audit: { create: false, read: "finance", update: false, delete: false },
  },
  marketing: {
    patients_demographic: { create: false, read: "limited", update: false, delete: false },
    invoices_payments: { create: false, read: "aggregate", update: false, delete: false },
    marketing_reports: { create: false, read: "aggregate", update: false, delete: false },
  },
  auditor: {
    patients_demographic: { create: false, read: "all", update: false, delete: false },
    clinical_notes: { create: false, read: "audited", update: false, delete: false },
    invoices_payments: { create: false, read: "all", update: false, delete: false },
    clinical_reports: { create: false, read: "all", update: false, delete: false },
    marketing_reports: { create: false, read: "all", update: false, delete: false },
    configuration: { create: false, read: "all", update: false, delete: false },
    users_roles: { create: false, read: "all", update: false, delete: false },
    audit: { create: false, read: "all", update: false, delete: false },
  },
};

function resolve(role: Role, resource: Resource): Access {
  return MATRIX[role]?.[resource] ?? NONE;
}

/** Highest-privilege access across a set of roles for a resource. */
export function accessFor(roles: Role[], resource: Resource): Access {
  return roles.reduce<Access>((acc, role) => {
    const a = resolve(role, resource);
    return {
      create: acc.create || a.create,
      read: mergeRead(acc.read, a.read),
      update: mergeUpdate(acc.update, a.update),
      delete: acc.delete || a.delete,
    };
  }, NONE);
}

const READ_RANK: ReadScope[] = [
  "none",
  "aggregate",
  "finance",
  "limited",
  "audited",
  "own",
  "assigned",
  "all",
];

function mergeRead(a: ReadScope, b: ReadScope): ReadScope {
  return READ_RANK.indexOf(a) >= READ_RANK.indexOf(b) ? a : b;
}

function mergeUpdate(
  a: Access["update"],
  b: Access["update"],
): Access["update"] {
  if (a === true || b === true) return true;
  if (a === "partial" || b === "partial") return "partial";
  if (a === "own" || b === "own") return "own";
  return false;
}

/**
 * Primary authorization check used by server code.
 * A `read` returns true when any scope other than "none" is granted; callers
 * must additionally apply the scope (see `readScopeFor`) to filter rows/fields.
 */
export function can(
  roles: Role[],
  resource: Resource,
  action: Action,
): boolean {
  const a = accessFor(roles, resource);
  switch (action) {
    case "create":
      return a.create;
    case "read":
      return a.read !== "none";
    case "update":
      return a.update !== false;
    case "delete":
      return a.delete;
  }
}

export function readScopeFor(roles: Role[], resource: Resource): ReadScope {
  return accessFor(roles, resource).read;
}
