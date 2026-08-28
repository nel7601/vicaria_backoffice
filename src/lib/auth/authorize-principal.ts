import { AuthorizationError } from "./errors";
import { mfaSatisfied } from "./mfa";
import {
  can,
  readScopeFor,
  type Action,
  type ReadScope,
  type Resource,
} from "./rbac";
import type { Principal } from "./principal";

/**
 * Transport-agnostic authorization gate (spec §4, ADR-003).
 *
 * This is the single decision point shared by the web (cookies) and the
 * assistant API (Bearer): same permission matrix, same MFA rule, same answer.
 * It is pure with respect to I/O — the principal is resolved before calling in
 * — which makes the whole matrix unit-testable per role without a database.
 *
 * It complements PostgreSQL RLS; it never replaces it. Hiding a UI control is
 * not a security control.
 */

/** True when the principal's assurance level meets its roles' MFA policy. */
export function principalMfaSatisfied(principal: Principal): boolean {
  return mfaSatisfied(principal.aal, principal.roles);
}

/**
 * Non-throwing check. A privileged role that has not cleared MFA carries no
 * effective authority, so it answers false for everything.
 */
export function principalCan(
  principal: Principal,
  resource: Resource,
  action: Action,
): boolean {
  if (!principalMfaSatisfied(principal)) return false;
  return can(principal.roles, resource, action);
}

/**
 * Read scope for this principal — narrows which rows/fields a read may return.
 * Returns "none" when MFA is outstanding, matching `principalCan`.
 */
export function principalReadScope(
  principal: Principal,
  resource: Resource,
): ReadScope {
  if (!principalMfaSatisfied(principal)) return "none";
  return readScopeFor(principal.roles, resource);
}

/**
 * Assert the principal may perform `action` on `resource`, or throw.
 *
 * Callers still have to apply the returned scope (see `principalReadScope`):
 * being allowed to read a resource is not permission to read every row of it.
 */
export function authorizePrincipal(
  principal: Principal,
  resource: Resource,
  action: Action,
): Principal {
  if (!principalCan(principal, resource, action)) {
    throw new AuthorizationError(resource, action);
  }
  return principal;
}
