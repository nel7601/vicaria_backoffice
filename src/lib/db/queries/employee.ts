import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { employees, users } from "@/lib/db/schema";

/**
 * Resolve the employee row for an authenticated user (for assigned/own scopes).
 * Mirrors the SQL helper app.current_employee_id() used by RLS.
 */
export async function getEmployeeIdForAuthUser(
  organizationId: string,
  authUserId: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ id: employees.id })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(
      and(
        eq(employees.organizationId, organizationId),
        eq(users.authUserId, authUserId),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}
