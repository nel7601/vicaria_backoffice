import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * "This account is not linked to an organization" is a sentence about the
 * user's account. It must not be what they are told when the query failed to
 * run: one sends them to an administrator, the other just needs retrying.
 */
const select = vi.fn();
vi.mock("@/lib/db", () => ({ getDb: () => ({ select }) }));

const { resolvePrincipalIdentity, IdentityLookupError } = await import("@/lib/auth/principal");

function chain(result: unknown[] | Error) {
  const step = () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result));
  const api: Record<string, unknown> = {};
  for (const name of ["from", "leftJoin", "where", "orderBy"]) api[name] = () => api;
  api.limit = step;
  return api;
}

beforeEach(() => select.mockReset());

describe("resolvePrincipalIdentity", () => {
  it("reports an account with no local row as unresolved", async () => {
    select.mockReturnValue(chain([]));
    await expect(resolvePrincipalIdentity("auth-1")).resolves.toMatchObject({
      dbUserId: null,
      organizationId: null,
    });
  });

  it("throws rather than reporting a failed query as an unlinked account", async () => {
    select.mockReturnValue(chain(new Error("connection terminated unexpectedly")));
    await expect(resolvePrincipalIdentity("auth-1")).rejects.toBeInstanceOf(IdentityLookupError);
  });

  it("keeps the underlying reason, so the cause is not lost", async () => {
    const cause = new Error("too many connections");
    select.mockReturnValue(chain(cause));
    await expect(resolvePrincipalIdentity("auth-1")).rejects.toMatchObject({ reason: cause });
  });

  it("returns the identity when the row is there", async () => {
    select.mockReturnValue(
      chain([
        {
          dbUserId: "user-1",
          organizationId: "org-1",
          isActive: true,
          employeeId: "emp-1",
          displayName: "Nelson",
          isPractitioner: false,
        },
      ]),
    );
    await expect(resolvePrincipalIdentity("auth-1")).resolves.toMatchObject({
      dbUserId: "user-1",
      organizationId: "org-1",
      displayName: "Nelson",
    });
  });
});
