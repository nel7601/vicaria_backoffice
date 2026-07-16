import { describe, expect, it } from "vitest";
import { mfaSatisfied, requiresMfa } from "@/lib/auth/mfa";

describe("MFA enforcement (§FR-AUTH-002)", () => {
  it("requires MFA for privileged roles", () => {
    expect(requiresMfa(["owner"])).toBe(true);
    expect(requiresMfa(["administrator"])).toBe(true);
    expect(requiresMfa(["billing"])).toBe(true);
    expect(requiresMfa(["auditor"])).toBe(true);
  });

  it("does not require MFA for non-privileged roles by default", () => {
    expect(requiresMfa(["reception"])).toBe(false);
    expect(requiresMfa(["practitioner"])).toBe(false);
    expect(requiresMfa(["marketing"])).toBe(false);
  });

  it("requires MFA when any held role is privileged", () => {
    expect(requiresMfa(["reception", "billing"])).toBe(true);
  });

  it("only grants a privileged session at aal2", () => {
    expect(mfaSatisfied("aal1", ["owner"])).toBe(false);
    expect(mfaSatisfied(null, ["owner"])).toBe(false);
    expect(mfaSatisfied("aal2", ["owner"])).toBe(true);
  });

  it("non-privileged roles are satisfied regardless of aal", () => {
    expect(mfaSatisfied("aal1", ["reception"])).toBe(true);
    expect(mfaSatisfied(null, ["marketing"])).toBe(true);
  });
});
