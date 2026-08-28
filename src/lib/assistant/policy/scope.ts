import { principalReadScope } from "@/lib/auth/authorize-principal";
import type { Principal } from "@/lib/auth/principal";
import type { Resource } from "@/lib/auth/rbac";

/**
 * Turning a read scope into a query filter (§4.3 of the assistant plan).
 *
 * `principalCan` only answers whether a resource may be read at all. The scope
 * says which rows and which fields, and that distinction is the whole point:
 * a practitioner may read patient data, but only for their own patients, and
 * marketing may read it only as counts with no names attached.
 *
 * Pure on purpose — every role can be tested without a database.
 */

export type ScopeMode =
  /** Every row in the organization. */
  | "organization"
  /** Only rows belonging to this principal's employee record. */
  | "own"
  /** Counts and aggregates only: no names, no identifiable rows. */
  | "aggregate"
  /** Nothing at all. */
  | "denied";

export interface ReadPlan {
  mode: ScopeMode;
  /** Set when mode is "own": the employee whose rows may be returned. */
  employeeId?: string;
  /** Whether the caller may see patient names and other identifying fields. */
  identifiable: boolean;
  /** Why it was narrowed, for the refusal message and for audit. */
  reason?: string;
}

const DENIED: ReadPlan = {
  mode: "denied",
  identifiable: false,
  reason: "This role cannot read this information.",
};

/**
 * Decide how far a read may go for this principal.
 *
 * A practitioner with no employee profile is denied rather than widened: their
 * scope is defined by rows linked to an employee record, so without one there
 * is no safe set of rows to return, and returning everything would be exactly
 * the wrong answer.
 */
export function planRead(
  principal: Principal,
  resource: Resource,
): ReadPlan {
  const scope = principalReadScope(principal, resource);

  switch (scope) {
    case "none":
      return DENIED;

    case "all":
    case "audited":
      return { mode: "organization", identifiable: true };

    case "assigned":
    case "own":
      if (!principal.employeeId) {
        return {
          ...DENIED,
          reason:
            "This role only sees its own records, but the account has no employee profile.",
        };
      }
      return {
        mode: "own",
        employeeId: principal.employeeId,
        identifiable: true,
      };

    case "limited":
    case "finance":
      // Readable, but not with identities attached.
      return { mode: "organization", identifiable: false };

    case "aggregate":
      return { mode: "aggregate", identifiable: false };
  }
}

/** True when the plan allows returning anything at all. */
export function isReadable(plan: ReadPlan): boolean {
  return plan.mode !== "denied";
}
