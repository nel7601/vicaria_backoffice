import { describe, expect, it } from "vitest";
import { accessFor, can, readScopeFor } from "@/lib/auth/rbac";

/**
 * Role matrix tests (spec §15.1 critical cases). These mirror the RLS policy
 * intent and must pass in CI (AC-08).
 */
describe("permission matrix (§4.2)", () => {
  it("marketing cannot read clinical notes (§15.1)", () => {
    expect(can(["marketing"], "clinical_notes", "read")).toBe(false);
    expect(readScopeFor(["marketing"], "clinical_notes")).toBe("none");
  });

  it("marketing only sees aggregate financials and marketing reports", () => {
    expect(readScopeFor(["marketing"], "invoices_payments")).toBe("aggregate");
    expect(readScopeFor(["marketing"], "marketing_reports")).toBe("aggregate");
  });

  it("practitioner reads only assigned patients and own notes", () => {
    expect(readScopeFor(["practitioner"], "patients_demographic")).toBe(
      "assigned",
    );
    expect(readScopeFor(["practitioner"], "clinical_notes")).toBe("own");
    expect(can(["practitioner"], "clinical_notes", "create")).toBe(true);
  });

  it("reception can manage patients but not clinical notes", () => {
    expect(can(["reception"], "patients_demographic", "create")).toBe(true);
    expect(can(["reception"], "clinical_notes", "read")).toBe(false);
  });

  it("billing has full invoices/payments but no clinical notes", () => {
    expect(can(["billing"], "invoices_payments", "delete")).toBe(true);
    expect(can(["billing"], "clinical_notes", "read")).toBe(false);
  });

  it("auditor is read-only everywhere it has access", () => {
    expect(can(["auditor"], "audit", "read")).toBe(true);
    expect(can(["auditor"], "audit", "update")).toBe(false);
    expect(can(["auditor"], "invoices_payments", "create")).toBe(false);
  });

  it("owner has full configuration and user management", () => {
    expect(can(["owner"], "configuration", "update")).toBe(true);
    expect(can(["owner"], "users_roles", "delete")).toBe(true);
  });

  it("administrator gets partial configuration, not full", () => {
    const a = accessFor(["administrator"], "configuration");
    expect(a.update).toBe("partial");
    expect(a.delete).toBe(false);
  });

  it("combines roles to the highest privilege", () => {
    // A user who is both reception and billing.
    expect(can(["reception", "billing"], "invoices_payments", "delete")).toBe(
      true,
    );
    expect(readScopeFor(["reception", "billing"], "patients_demographic")).toBe(
      "all",
    );
  });
});
