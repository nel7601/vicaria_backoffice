import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import type { Role } from "./rbac";

/**
 * Employee account provisioning (FR-ADM-002).
 *
 * An employee row is only half a person: without a Supabase Auth account
 * linked through `users.auth_user_id`, they cannot sign in at all — RLS
 * resolves the current user through that column (`0002_rls_policies.sql`), so
 * every policy denies them, and the assistant API refuses them for the same
 * reason. Creating the employee and creating the account have to happen
 * together.
 *
 * Server-only: it holds the service-role client, which bypasses RLS. Never
 * import it from a client component.
 */

export type ProvisionOutcome =
  | { ok: true; authUserId: string; invited: boolean }
  | { ok: false; error: string };

/**
 * Where the invitation link lands. New accounts have no password, so they go
 * to the reset form; it is a public path, and the email link carries the
 * session that authorises the change.
 */
async function invitationRedirect(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return `${configured.replace(/\/$/, "")}/reset-password`;

  // Fall back to the origin of the request being served.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}/reset-password` : "/reset-password";
}

/** Look up an existing auth account by email, paging through the admin list. */
async function findAuthUserByEmail(
  admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>,
  email: string,
): Promise<string | null> {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error || !data?.users?.length) return null;
    const found = data.users.find((u) => u.email?.toLowerCase() === target);
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/**
 * Whether an invite failed because the address already has an account.
 *
 * Supabase has worded this several ways across versions, and the difference
 * matters: a false negative sends a second invitation to someone who already
 * has one, a false positive reports a real failure as "already registered".
 * Exported so the wording list is testable.
 */
export function alreadyRegistered(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("already been registered") ||
    m.includes("already registered") ||
    m.includes("email_exists") ||
    m.includes("user already exists")
  );
}

/**
 * Give an employee a sign-in account and link it to their `users` row.
 *
 * Sends an invitation when the address is new; when an auth account already
 * exists for it (a re-invite, or an account created before this code existed)
 * it links that one instead of sending a second email. Role claims are written
 * in the same step so the very first session carries the right authority.
 *
 * Never throws: the caller has already written the employee to the database,
 * and losing that work because an email failed to send would be worse than
 * reporting an un-invited employee the owner can retry.
 */
export async function provisionEmployeeAccount(params: {
  organizationId: string;
  /** Local `users.id`, not the auth id. */
  userId: string;
  email: string;
  roles: Role[];
}): Promise<ProvisionOutcome> {
  const { organizationId, userId, email, roles } = params;

  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();

    let authUserId: string | null = null;
    let invited = false;

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: await invitationRedirect(),
    });

    if (error) {
      if (!alreadyRegistered(error.message)) {
        return { ok: false, error: `Invitation failed: ${error.message}` };
      }
      // The address already has an account: link it rather than emailing again.
      authUserId = await findAuthUserByEmail(admin, email);
      if (!authUserId) {
        return {
          ok: false,
          error:
            "This email already has an account, but it could not be located to link it.",
        };
      }
    } else {
      authUserId = data.user?.id ?? null;
      invited = true;
      if (!authUserId) {
        return { ok: false, error: "The invitation returned no account id." };
      }
    }

    // Claims first: a linked row whose JWT carries no roles would sign in with
    // no authority at all and look like a broken account.
    const { error: claimsError } = await admin.auth.admin.updateUserById(
      authUserId,
      { app_metadata: { roles, organization_id: organizationId } },
    );
    if (claimsError) {
      return { ok: false, error: `Could not set role claims: ${claimsError.message}` };
    }

    const db = getDb();
    await db
      .update(users)
      .set({ authUserId, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return { ok: true, authUserId, invited };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    // `auth_user_id` is unique: this fires when the account is already linked
    // to a different employee row, which is a data problem, not a transient one.
    if (message.includes("users_auth_user_id_unique")) {
      return {
        ok: false,
        error: "That account is already linked to another employee.",
      };
    }
    return { ok: false, error: `Could not provision the account: ${message}` };
  }
}
