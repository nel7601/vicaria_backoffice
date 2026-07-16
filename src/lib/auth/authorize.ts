import { getSessionUser, type SessionUser } from "./session";
import { can, type Action, type Resource } from "./rbac";

/**
 * Server-side authorization gate (spec §4, ADR-003).
 *
 * This is the enforcement layer that server code MUST call before any
 * privileged read/mutation. It is independent of (and complementary to)
 * PostgreSQL RLS. Never rely on hidden UI as a control.
 */
export class AuthorizationError extends Error {
  constructor(
    public readonly resource: Resource,
    public readonly action: Action,
  ) {
    super(`Not authorized to ${action} ${resource}`);
    this.name = "AuthorizationError";
  }
}

export class AuthenticationError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthenticationError";
  }
}

/** Resolve the session or throw. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthenticationError();
  return user;
}

/**
 * Assert the current user may perform `action` on `resource`. Returns the
 * session user so callers can use its roles/scopes for row/field filtering.
 */
export async function authorize(
  resource: Resource,
  action: Action,
): Promise<SessionUser> {
  const user = await requireUser();

  // A privileged role that hasn't cleared MFA has no effective authority.
  if (user.mfaRequired && !user.mfaSatisfied) {
    throw new AuthorizationError(resource, action);
  }

  if (!can(user.roles, resource, action)) {
    throw new AuthorizationError(resource, action);
  }
  return user;
}
