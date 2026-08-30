import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { employees, users } from "@/lib/db/schema";
import type { Principal } from "@/lib/auth/principal";

/**
 * Who Yise is, as far as the clinic's records are concerned.
 *
 * Yise has no permission model. That was the point of it: one app, one login,
 * everything visible. But "no permissions" cannot mean "no identity" — every
 * query still has to be scoped to an organization, and every write still has
 * to be signed by a row in `users`, or the foreign keys refuse it and the
 * audit trail records nothing at all.
 *
 * So there is exactly one identity, named in the environment, and it is the
 * one the audit log will show. Whoever is holding the phone, the trail says
 * this account did it. That is the honest cost of dropping roles, and it is
 * worth stating plainly rather than discovering later while reading an audit.
 */
export class YiseIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YiseIdentityError";
  }
}

let cached: (Principal & { organizationId: string; dbUserId: string }) | null = null;

export async function yisePrincipal(): Promise<
  Principal & { organizationId: string; dbUserId: string }
> {
  if (cached) return cached;

  const email = process.env.YISE_ACTOR_EMAIL;
  if (!email) {
    throw new YiseIdentityError("YISE_ACTOR_EMAIL is not set");
  }

  const [row] = await getDb()
    .select({
      dbUserId: users.id,
      organizationId: users.organizationId,
      authUserId: users.authUserId,
      isActive: users.isActive,
      employeeId: employees.id,
      firstName: employees.firstName,
      isPractitioner: employees.isPractitioner,
    })
    .from(users)
    .leftJoin(employees, eq(employees.userId, users.id))
    .where(and(eq(users.email, email), eq(users.isActive, true)))
    .limit(1);

  if (!row) {
    throw new YiseIdentityError(`No active user with email ${email}`);
  }

  cached = {
    authUserId: row.authUserId ?? "",
    email,
    // Every tool in the catalogue, because that is what was asked for. The
    // tools still check this, so the answer has to be a role that really can.
    roles: ["owner"],
    aal: "aal2",
    dbUserId: row.dbUserId,
    organizationId: row.organizationId,
    employeeId: row.employeeId ?? null,
    displayName: row.firstName ?? null,
    isPractitioner: row.isPractitioner ?? false,
    locale: "es",
    source: "assistant",
  };
  return cached;
}
