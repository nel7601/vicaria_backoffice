import { authorizePrincipal } from "./authorize-principal";
import { AuthenticationError, AuthorizationError } from "./errors";
import {
  resolvePrincipalIdentity,
  type Principal,
  type PrincipalIdentity,
} from "./principal";
import type { Action, Resource } from "./rbac";
import { getSessionUser, type SessionUser } from "./session";

/**
 * Web authorization adapter (spec §4, ADR-003).
 *
 * Server code MUST call this before any privileged read/mutation. The decision
 * itself lives in `authorize-principal.ts`, shared with the assistant API, so
 * that both transports enforce one permission matrix. This module only turns a
 * cookie session into a `Principal`.
 *
 * It is independent of (and complementary to) PostgreSQL RLS. Never rely on
 * hidden UI as a control.
 */
export { AuthenticationError, AuthorizationError };

/** Resolve the session or throw. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthenticationError();
  return user;
}

/** SessionUser plus the local users.id row that DB foreign keys reference. */
export type AuthorizedUser = SessionUser & { dbUserId: string | null };

const UNRESOLVED_IDENTITY: PrincipalIdentity = {
  dbUserId: null,
  organizationId: null,
  employeeId: null,
  isPractitioner: false,
  isActive: true,
};

/** Build a web principal from a session, with identity fields already known. */
export function principalFromSession(
  user: SessionUser,
  identity: PrincipalIdentity = UNRESOLVED_IDENTITY,
  locale: Principal["locale"] = "en",
): Principal {
  return {
    authUserId: user.authId,
    email: user.email,
    roles: user.roles,
    aal: user.aal,
    dbUserId: identity.dbUserId,
    organizationId: identity.organizationId,
    employeeId: identity.employeeId,
    isPractitioner: identity.isPractitioner,
    locale,
    source: "web",
  };
}

/**
 * Assert the current user may perform `action` on `resource`. Returns the
 * session user (with the local DB user id resolved) so callers can use its
 * roles/scopes for filtering and its dbUserId for actor foreign keys.
 */
export async function authorize(
  resource: Resource,
  action: Action,
): Promise<AuthorizedUser> {
  const user = await requireUser();

  // Permission + MFA decision — identical to the one the assistant API makes.
  authorizePrincipal(principalFromSession(user), resource, action);

  // Resolve the local users.id (FK target for signed_by/received_by/etc.).
  // Null when no local row is linked yet; writers must handle that. Resolved
  // after the check so an unauthorized call still costs no query.
  const { dbUserId } = await resolvePrincipalIdentity(user.authId);

  return { ...user, dbUserId };
}

/**
 * Full web principal (session + tenant + employee profile).
 *
 * Use when server code needs the organization or employee id rather than just
 * an authorization verdict. `authorize()` stays the cheaper path for the 60-odd
 * existing call sites that only need `dbUserId`.
 */
export async function requirePrincipal(
  locale: Principal["locale"] = "en",
): Promise<Principal> {
  const user = await requireUser();
  const identity = await resolvePrincipalIdentity(user.authId);
  return principalFromSession(user, identity, locale);
}
