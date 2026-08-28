import { describe, expect, it } from "vitest";
import { isReadable, planRead } from "@/lib/assistant/policy/scope";
import type { Principal } from "@/lib/auth/principal";
import type { Role } from "@/lib/auth/rbac";

/**
 * The read plan is what stands between "this role may read patients" and "this
 * role may read THESE patients". A bug here does not throw — it silently
 * returns other people's data, so every role is pinned down explicitly.
 */

function principal(roles: Role[], overrides: Partial<Principal> = {}): Principal {
  return {
    authUserId: "auth-1",
    email: "u@example.com",
    roles,
    aal: "aal2",
    dbUserId: "user-1",
    organizationId: "org-1",
    employeeId: "emp-1",
    isPractitioner: false,
    locale: "en",
    source: "assistant",
    ...overrides,
  };
}

describe("patient data by role", () => {
  it("lets owner, administrator and reception see the whole clinic", () => {
    for (const role of ["owner", "administrator", "reception"] as Role[]) {
      const plan = planRead(principal([role]), "patients_demographic");
      expect(plan.mode, role).toBe("organization");
      expect(plan.identifiable, role).toBe(true);
    }
  });

  it("narrows a practitioner to their own employee record", () => {
    const plan = planRead(principal(["practitioner"]), "patients_demographic");
    expect(plan).toMatchObject({
      mode: "own",
      employeeId: "emp-1",
      identifiable: true,
    });
  });

  it("gives marketing counts without identities", () => {
    const plan = planRead(principal(["marketing"]), "patients_demographic");
    expect(plan.identifiable).toBe(false);
    expect(plan.mode).toBe("organization");
  });

  it("denies a role with no access to clinical notes", () => {
    const plan = planRead(principal(["marketing"]), "clinical_notes");
    expect(plan.mode).toBe("denied");
    expect(isReadable(plan)).toBe(false);
  });
});

describe("the dangerous edges", () => {
  it("denies a practitioner with no employee profile instead of widening", () => {
    // The failure to avoid: no employee id, no filter, every patient returned.
    const plan = planRead(
      principal(["practitioner"], { employeeId: null }),
      "patients_demographic",
    );
    expect(plan.mode).toBe("denied");
    expect(plan.reason).toContain("no employee profile");
  });

  it("denies everything when MFA is outstanding for a privileged role", () => {
    const plan = planRead(
      principal(["owner"], { aal: "aal1" }),
      "patients_demographic",
    );
    expect(plan.mode).toBe("denied");
  });

  it("gives a principal with no roles nothing", () => {
    expect(planRead(principal([]), "patients_demographic").mode).toBe("denied");
  });

  it("widens to the clinic when a practitioner also holds a wider role", () => {
    // Matches the web: the highest-privilege role across the set wins.
    const plan = planRead(
      principal(["practitioner", "owner"]),
      "patients_demographic",
    );
    expect(plan.mode).toBe("organization");
  });
});
