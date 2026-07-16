import { createClient } from "@/lib/supabase/server";
import type { Role } from "./rbac";

export interface SessionUser {
  authId: string;
  email: string;
  roles: Role[];
}

/**
 * Resolve the current authenticated user and their roles.
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

  return {
    authId: user.id,
    email: user.email ?? "",
    roles,
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
