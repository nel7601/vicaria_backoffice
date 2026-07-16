import type { Role } from "./rbac";

/**
 * MFA enforcement (spec FR-AUTH-002).
 *
 * MFA is REQUIRED for privileged roles (Owner, Administrator, Billing,
 * Auditor) and may be extended to all roles. A privileged session is only
 * granted with a valid second factor: Supabase reports this via the session
 * Authenticator Assurance Level (`aal2` = second factor verified).
 */

/** Roles that must complete MFA before holding a session (§FR-AUTH-002). */
export const MFA_REQUIRED_ROLES: readonly Role[] = [
  "owner",
  "administrator",
  "billing",
  "auditor",
];

/** When true, every role is forced through MFA (configurable rollout). */
export const MFA_REQUIRED_FOR_ALL = false;

export function requiresMfa(roles: Role[]): boolean {
  if (MFA_REQUIRED_FOR_ALL) return true;
  return roles.some((r) => MFA_REQUIRED_ROLES.includes(r));
}

export type AssuranceLevel = "aal1" | "aal2" | null;

/**
 * Returns true when the current assurance level satisfies the MFA requirement
 * for the given roles. A user whose roles require MFA must be at aal2.
 */
export function mfaSatisfied(aal: AssuranceLevel, roles: Role[]): boolean {
  if (!requiresMfa(roles)) return true;
  return aal === "aal2";
}
