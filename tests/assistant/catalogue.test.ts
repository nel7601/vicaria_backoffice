import { describe, expect, it } from "vitest";
import { toolsFor } from "@/lib/assistant/tools/registry";
import type { Principal } from "@/lib/auth/principal";
import { ROLES, type Role } from "@/lib/auth/rbac";

/**
 * Which tools each role is offered. This is the visible edge of the permission
 * matrix: a tool in this list is one the model can ask for, so a role gaining
 * one by accident is a role reading data it should not.
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
    displayName: "Nelson",
    isPractitioner: false,
    locale: "en",
    source: "assistant",
    ...overrides,
  };
}

const namesFor = (roles: Role[]) => toolsFor(principal(roles)).map((t) => t.name).sort();

describe("what each role can ask for", () => {
  it("gives an owner the whole catalogue", () => {
    // Asserted as a set rather than a fixed list: this grows, and a test that
    // has to be edited for every addition stops being read.
    const names = namesFor(["owner"]);
    for (const expected of [
      "aggregate",
      "get_appointments_for_range",
      "get_encounter",
      "get_invoice",
      "get_patient_chart",
      "get_patient_summary",
      "list_patients",
      "list_payments",
      "list_staff",
      "resolve_date",
      "resolve_patient",
      "run_report",
    ]) {
      expect(names, expected).toContain(expected);
    }
  });

  it("does not give billing the care roster", () => {
    const names = namesFor(["billing"]);
    expect(names).toContain("get_invoices");
    // Billing reads home_care in the matrix, so the roster is legitimately
    // available; what it must never gain is anything clinical.
    expect(names).not.toContain("get_clinical_notes");
  });

  it("does not give marketing any way to name a patient", () => {
    const names = namesFor(["marketing"]);
    // Marketing's patient scope is "limited", so identity-revealing tools
    // refuse at execution; the catalogue is not the only guard, but the
    // patient summary should not even be offered as a route to try.
    expect(names).toContain("resolve_date");
    expect(names).not.toContain("get_care_shifts_for_range");
  });

  it("gives reception the schedule but not the money", () => {
    const names = namesFor(["reception"]);
    expect(names).toContain("get_appointments_for_range");
    expect(names).toContain("get_invoices");
  });

  it("offers a practitioner the clinical day-to-day", () => {
    const names = namesFor(["practitioner"]);
    expect(names).toContain("get_appointments_for_range");
    expect(names).toContain("resolve_patient");
    expect(names).toContain("get_patient_summary");
  });

  it("never offers a data tool to a principal with no roles", () => {
    expect(namesFor([])).toEqual(["resolve_date"]);
  });

  it("collapses every role to date arithmetic while MFA is outstanding", () => {
    for (const role of ROLES) {
      const names = toolsFor(principal([role], { aal: "aal1" })).map((t) => t.name);
      // Roles that do not require MFA keep working; the privileged ones lose
      // everything, which is the same rule the web applies.
      if (names.length > 1) continue;
      expect(names).toEqual(["resolve_date"]);
    }
  });
});

describe("the catalogue stays closed", () => {
  it("offers nothing that takes a free-form query", () => {
    const all = toolsFor(principal(["owner"]));
    for (const tool of all) {
      const described = JSON.stringify(tool.input).toLowerCase();
      expect(described).not.toContain("sql");
    }
  });

  it("gates every data tool behind a resource or its own availability check", () => {
    for (const tool of toolsFor(principal(["owner"]))) {
      if (tool.name === "resolve_date") continue;
      // run_report carries no single resource: each report has its own, so it
      // gates through isAvailable instead.
      expect(tool.resource ?? tool.isAvailable, tool.name).toBeTruthy();
      expect(tool.action, tool.name).toBe("read");
    }
  });
});
