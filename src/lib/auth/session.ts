import { createClient } from "@/lib/supabase/server";
import type { Role } from "./rbac";
import { mfaSatisfied, requiresMfa, type AssuranceLevel } from "./mfa";

export interface SessionUser {
  authId: string;
  email: string;
  roles: Role[];
  /** Current Authenticator Assurance Level from Supabase. */
  aal: AssuranceLevel;
  /** True when MFA requirements for this user's roles are met. */
  mfaSatisfied: boolean;
  /** True when the user must enroll/verify MFA before continuing. */
  mfaRequired: boolean;
}

/**
 * Resolve the current authenticated user, their roles and MFA state.
 *
 * MVP note: roles are read from the Supabase JWT `app_metadata.roles` claim.
 * A DB-backed lookup against `user_roles` (with location scopes) replaces this
 * once the authorization migration lands (ADR-003). Returns null when there is
 * no valid session.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const claimRoles = (user.app_metadata?.roles ?? []) as string[];
  const roles = claimRoles.filter(isRole);

  const { data: aalData } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const aal = (aalData?.currentLevel ?? null) as AssuranceLevel;

  return {
    authId: user.id,
    email: user.email ?? "",
    roles,
    aal,
    mfaRequired: requiresMfa(roles),
    mfaSatisfied: mfaSatisfied(aal, roles),
  };
}

function isRole(value: string): value is Role {
  return [
    "owner",
    "administrator",
    "practitioner",
    "reception",
    "billing",
    "marketing",
    "auditor",
  ].includes(value);
}
