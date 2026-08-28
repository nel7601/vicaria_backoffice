import { beforeEach, describe, expect, it } from "vitest";
import {
  authorizePrincipal,
  principalCan,
  principalMfaSatisfied,
  principalReadScope,
} from "@/lib/auth/authorize-principal";
import { AuthorizationError } from "@/lib/auth/errors";
import { MFA_REQUIRED_ROLES } from "@/lib/auth/mfa";
import type { Principal } from "@/lib/auth/principal";
import { ACTIONS_UNDER_TEST, RESOURCES, ROLES, can, readScopeFor } from "./helpers";

/**
 * The assistant APK and the web must reach the SAME verdict for the same user
 * (§4.1 of the assistant plan). These tests are the contract that lets the
 * Bearer path reuse the matrix: if they ever diverge, one transport is granting
 * authority the other refuses.
 */

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    authUserId: "00000000-0000-0000-0000-000000000001",
    email: "user@example.com",
    roles: ["reception"],
    aal: "aal2",
    dbUserId: "00000000-0000-0000-0000-000000000002",
    organizationId: "00000000-0000-0000-0000-000000000003",
    employeeId: null,
    isPractitioner: false,
    locale: "en",
    source: "assistant",
    ...overrides,
  };
}

beforeEach(() => {
  process.env.MFA_ENFORCEMENT = "on";
});

describe("web/assistant equivalence", () => {
  it("matches the raw matrix for every role, resource and action at aal2", () => {
    for (const role of ROLES) {
      const p = principal({ roles: [role] });
      for (const resource of RESOURCES) {
        for (const action of ACTIONS_UNDER_TEST) {
          expect(
            principalCan(p, resource, action),
            `${role} / ${resource} / ${action}`,
          ).toBe(can([role], resource, action));
        }
        expect(principalReadScope(p, resource)).toBe(
          readScopeFor([role], resource),
        );
      }
    }
  });

  it("gives a multi-role principal the union of its roles, like the web", () => {
    const p = principal({ roles: ["reception", "billing"] });
    expect(principalCan(p, "invoices_payments", "delete")).toBe(true);
    expect(principalCan(p, "clinical_notes", "read")).toBe(false);
  });

  it("does not let source, tenant or employee fields change the verdict", () => {
    const web = principal({ roles: ["practitioner"], source: "web" });
    const apk = principal({
      roles: ["practitioner"],
      source: "assistant",
      organizationId: "99999999-9999-9999-9999-999999999999",
      employeeId: "88888888-8888-8888-8888-888888888888",
      isPractitioner: true,
    });
    for (const resource of RESOURCES) {
      for (const action of ACTIONS_UNDER_TEST) {
        expect(principalCan(web, resource, action)).toBe(
          principalCan(apk, resource, action),
        );
      }
    }
  });
});

describe("MFA gate (FR-AUTH-002)", () => {
  it("strips all authority from a privileged role stuck at aal1", () => {
    for (const role of MFA_REQUIRED_ROLES) {
      const p = principal({ roles: [role], aal: "aal1" });
      expect(principalMfaSatisfied(p)).toBe(false);
      for (const resource of RESOURCES) {
        expect(principalCan(p, resource, "read")).toBe(false);
        expect(principalReadScope(p, resource)).toBe("none");
      }
    }
  });

  it("treats a missing assurance level like aal1, not like a pass", () => {
    const p = principal({ roles: ["owner"], aal: null });
    expect(principalCan(p, "configuration", "update")).toBe(false);
  });

  it("leaves non-privileged roles working at aal1", () => {
    const p = principal({ roles: ["reception"], aal: "aal1" });
    expect(principalCan(p, "patients_demographic", "create")).toBe(true);
  });

  it("honours the MFA_ENFORCEMENT=off development switch", () => {
    process.env.MFA_ENFORCEMENT = "off";
    const p = principal({ roles: ["owner"], aal: "aal1" });
    expect(principalCan(p, "configuration", "update")).toBe(true);
  });
});

describe("authorizePrincipal", () => {
  it("returns the principal when allowed", () => {
    const p = principal({ roles: ["billing"] });
    expect(authorizePrincipal(p, "invoices_payments", "update")).toBe(p);
  });

  it("throws AuthorizationError naming the resource and action", () => {
    const p = principal({ roles: ["marketing"] });
    try {
      authorizePrincipal(p, "clinical_notes", "read");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthorizationError);
      expect((error as AuthorizationError).resource).toBe("clinical_notes");
      expect((error as AuthorizationError).action).toBe("read");
    }
  });

  it("throws for a role with no roles at all", () => {
    const p = principal({ roles: [] });
    expect(() => authorizePrincipal(p, "patients_demographic", "read")).toThrow(
      AuthorizationError,
    );
  });
});
