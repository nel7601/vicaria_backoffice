import { createClient, isAuthRetryableFetchError } from "@supabase/supabase-js";
import { mfaSatisfied, requiresMfa, type AssuranceLevel } from "@/lib/auth/mfa";
import { resolvePrincipalIdentity, type Principal } from "@/lib/auth/principal";
import { ROLES, type Role } from "@/lib/auth/rbac";

/**
 * Bearer token -> Principal for the assistant API (§4.1 of the assistant plan).
 *
 * The APK authenticates against the same Supabase project as the web, so the
 * user, their roles and their MFA state are the ones the backoffice already
 * knows. This module verifies the token and resolves the tenant; the RBAC
 * decision itself belongs to `authorizePrincipal`.
 *
 * Nothing here reads authority from the request body: organization, employee
 * and roles come from the verified token and the local `users` row only.
 */

export type AssistantAuthCode =
  | "missing_token"
  | "invalid_token"
  | "inactive_user"
  | "no_tenant"
  | "mfa_required"
  | "auth_unavailable";

export class AssistantAuthError extends Error {
  constructor(
    public readonly code: AssistantAuthCode,
    message: string,
  ) {
    super(message);
    this.name = "AssistantAuthError";
  }

  /**
   * Unauthenticated (401), authenticated-but-refused (403), or "ask again
   * later" (503).
   *
   * The 503 matters: a client that reads 401 as "my token is dead" would sign
   * the user out and discard a perfectly valid session every time the auth
   * server has a bad minute.
   */
  get status(): 401 | 403 | 503 {
    if (this.code === "auth_unavailable") return 503;
    return this.code === "missing_token" || this.code === "invalid_token"
      ? 401
      : 403;
  }
}

/** Extract the raw JWT from an `Authorization: Bearer <token>` header. */
export function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  if (!token) {
    throw new AssistantAuthError(
      "missing_token",
      "Authorization: Bearer <token> is required",
    );
  }
  return token;
}

interface VerifiedClaims {
  authUserId: string;
  email: string;
  roles: Role[];
  aal: AssuranceLevel;
}

/**
 * Verify the token's signature and expiry with Supabase and return its claims.
 *
 * `getClaims` verifies asymmetric keys locally against the cached JWKS, and
 * falls back to a server round-trip for symmetric secrets. We never decode the
 * token ourselves: an unverified JWT is attacker-controlled input.
 */
export async function verifyAccessToken(
  token: string,
): Promise<VerifiedClaims> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Assistant auth requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.auth.getClaims(token);

  // A network/5xx failure means we could not verify the token, not that the
  // token is bad. Refuse the request, but tell the client to retry rather than
  // to throw the session away.
  if (isAuthRetryableFetchError(error)) {
    throw new AssistantAuthError(
      "auth_unavailable",
      "Could not verify the session; try again",
    );
  }
  if (error || !data?.claims?.sub) {
    throw new AssistantAuthError("invalid_token", "Invalid or expired token");
  }

  const claims = data.claims;
  const appMetadata = (claims.app_metadata ?? {}) as { roles?: unknown };
  const claimRoles = Array.isArray(appMetadata.roles)
    ? (appMetadata.roles as unknown[])
    : [];

  return {
    authUserId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
    // Same source of truth as the web session (session.ts): the JWT claim.
    // Moving roles to the `user_roles` table (ADR-003) must change both at once.
    roles: claimRoles.filter(isRole),
    aal: (claims.aal ?? null) as AssuranceLevel,
  };
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Build the assistant principal for a request, or throw `AssistantAuthError`.
 *
 * Stricter than the web adapter on purpose: a mobile caller with no local user
 * row, a deactivated account, or an outstanding MFA requirement is refused
 * outright rather than degraded, because every assistant tool needs a tenant to
 * scope its query and a refusal is the safe default.
 */
export async function requestPrincipal(
  request: Request,
  locale: Principal["locale"] = "en",
): Promise<Principal> {
  const claims = await verifyAccessToken(bearerToken(request));
  const identity = await resolvePrincipalIdentity(claims.authUserId);

  if (!identity.dbUserId || !identity.organizationId) {
    throw new AssistantAuthError(
      "no_tenant",
      "This account is not linked to an organization",
    );
  }
  if (!identity.isActive) {
    throw new AssistantAuthError("inactive_user", "This account is disabled");
  }
  if (requiresMfa(claims.roles) && !mfaSatisfied(claims.aal, claims.roles)) {
    throw new AssistantAuthError(
      "mfa_required",
      "Multi-factor authentication is required for this role",
    );
  }

  return {
    authUserId: claims.authUserId,
    email: claims.email,
    roles: claims.roles,
    aal: claims.aal,
    dbUserId: identity.dbUserId,
    organizationId: identity.organizationId,
    employeeId: identity.employeeId,
    isPractitioner: identity.isPractitioner,
    locale,
    source: "assistant",
  };
}
