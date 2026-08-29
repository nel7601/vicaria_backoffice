import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { employees, users } from "@/lib/db/schema";
import type { AssuranceLevel } from "./mfa";
import type { Role } from "./rbac";

/**
 * Principal — the authenticated actor, independent of transport (§4.1 of the
 * assistant plan).
 *
 * The web resolves it from session cookies; the assistant API resolves it from
 * a Supabase Bearer token. Both then flow through the same RBAC gate
 * (`authorizePrincipal`), so the APK can never hold authority the web session
 * of the same user would not have.
 *
 * HARD RULE: every field here is resolved server-side. A client (or the LLM)
 * may never supply `organizationId`, `employeeId` or `roles` as a source of
 * authority — they are read from the verified token and the local `users` row.
 */
export interface Principal {
  /** Supabase `auth.users.id` — the verified subject of the session/token. */
  authUserId: string;
  email: string;
  roles: Role[];
  /** Authenticator Assurance Level of the session/token (`aal2` = MFA done). */
  aal: AssuranceLevel;
  /**
   * Local `users.id`. Null when no local row is linked to this auth user yet;
   * writers that need an actor foreign key must handle that (this mirrors the
   * pre-existing behaviour of `authorize()` and keeps the web unchanged).
   */
  dbUserId: string | null;
  /**
   * Tenant boundary (§9.3). Null only when the local row is missing. Assistant
   * tools must go through `requireTenant()` rather than reading it directly.
   */
  organizationId: string | null;
  /** `employees.id` when this user has a labour profile, else null. */
  employeeId: string | null;
  /** First name, for addressing the person. Irrelevant to authorization. */
  displayName: string | null;
  isPractitioner: boolean;
  /** Response language for the assistant; irrelevant to authorization. */
  locale: "en" | "es";
  /** Where the principal came from — for audit (`source=assistant`) only. */
  source: "web" | "assistant";
}

/** Identity fields that only the database can answer. */
export interface PrincipalIdentity {
  dbUserId: string | null;
  organizationId: string | null;
  employeeId: string | null;
  displayName: string | null;
  isPractitioner: boolean;
  isActive: boolean;
}

const UNRESOLVED: PrincipalIdentity = {
  dbUserId: null,
  organizationId: null,
  employeeId: null,
  displayName: null,
  isPractitioner: false,
  isActive: true,
};

/**
 * Resolve the local identity (users row + optional employee profile) for a
 * Supabase auth user.
 *
 * A user with several employee rows is not prevented by the schema; we take
 * the oldest deterministically rather than picking at random.
 *
 * Returns `UNRESOLVED` when the database is unreachable, preserving the
 * existing web behaviour where a DB hiccup degrades `dbUserId` to null instead
 * of locking the user out. Callers that require a tenant (the assistant) must
 * use `requireTenant()`, which rejects that state.
 */
export async function resolvePrincipalIdentity(
  authUserId: string,
): Promise<PrincipalIdentity> {
  try {
    const db = getDb();
    const [row] = await db
      .select({
        dbUserId: users.id,
        organizationId: users.organizationId,
        isActive: users.isActive,
        employeeId: employees.id,
        displayName: employees.firstName,
        isPractitioner: employees.isPractitioner,
      })
      .from(users)
      .leftJoin(employees, eq(employees.userId, users.id))
      .where(eq(users.authUserId, authUserId))
      .orderBy(asc(employees.createdAt))
      .limit(1);

    if (!row) return UNRESOLVED;

    return {
      dbUserId: row.dbUserId,
      organizationId: row.organizationId,
      employeeId: row.employeeId ?? null,
      displayName: row.displayName ?? null,
      isPractitioner: row.isPractitioner ?? false,
      isActive: row.isActive,
    };
  } catch {
    return UNRESOLVED;
  }
}

export class TenantResolutionError extends Error {
  constructor() {
    super("No organization is linked to this user");
    this.name = "TenantResolutionError";
  }
}

/**
 * Assert the principal is bound to a tenant and return it narrowed.
 *
 * Every assistant tool starts here: without an organization there is no way to
 * scope a query safely, and answering "for the whole database" is exactly the
 * cross-tenant leak the plan forbids.
 */
export function requireTenant(
  principal: Principal,
): Principal & { organizationId: string; dbUserId: string } {
  if (!principal.organizationId || !principal.dbUserId) {
    throw new TenantResolutionError();
  }
  return principal as Principal & {
    organizationId: string;
    dbUserId: string;
  };
}
