import { describe, expect, it } from "vitest";
import { runReportTool } from "@/lib/assistant/tools/reports";
import type { ToolContext } from "@/lib/assistant/tools/types";
import type { Principal } from "@/lib/auth/principal";
import type { Role } from "@/lib/auth/rbac";
import { zonedInstantUtc } from "@/lib/domain/timezone";

/**
 * run_report is the one tool whose permission lives in another registry — the
 * web's report catalogue. These pin the two together: a report the reports
 * page would not show must not be runnable by voice either.
 */

function ctx(roles: Role[]): ToolContext {
  const principal: Principal = {
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
  };
  return {
    principal: principal as ToolContext["principal"],
    now: zonedInstantUtc("2026-08-26", 14),
    timeZone: "America/Toronto",
  };
}

const run = (roles: Role[], args: Record<string, unknown>) =>
  runReportTool.execute(args as never, ctx(roles)) as Promise<{
    catalogue?: { code: string }[];
    refused?: boolean;
    reason?: string;
  }>;

describe("the catalogue follows the role", () => {
  it("offers an owner the financial reports", async () => {
    const result = await run(["owner"], {});
    expect(result.catalogue?.map((r) => r.code)).toContain("FIN-01");
  });

  it("offers marketing the aggregated reports its scope allows", async () => {
    const codes = (await run(["marketing"], {})).catalogue?.map((r) => r.code);
    expect(codes).toContain("MKT-01");
    // Marketing's billing scope is "aggregate" and every financial report
    // returns totals with no names, so these are legitimately in reach — the
    // same as on the reports page.
    expect(codes).toContain("FIN-01");
    // Clinical reports are a resource it does not hold at all.
    expect(codes).not.toContain("CLN-01");
  });

  it("keeps clinical reports away from reception", async () => {
    const codes = (await run(["reception"], {})).catalogue?.map((r) => r.code);
    expect(codes).not.toContain("CLN-01");
    expect(codes).not.toContain("CLN-03");
  });

  it("offers nothing to a principal with no roles", async () => {
    expect((await run([], {})).catalogue).toEqual([]);
  });
});

describe("refusing codes", () => {
  it("refuses a report this role may not run", async () => {
    const result = await run(["marketing"], { code: "CLN-01" });
    expect(result.refused).toBe(true);
  });

  it("refuses an invented code the same way as a forbidden one", async () => {
    const forbidden = await run(["marketing"], { code: "CLN-01" });
    const invented = await run(["marketing"], { code: "ZZZ-99" });
    // Both say "not available to you": probing codes must not reveal which
    // reports exist for other roles.
    expect(forbidden.reason?.replace("CLN-01", "X")).toBe(
      invented.reason?.replace("ZZZ-99", "X"),
    );
  });

  it("shows only this role's own catalogue when refusing", async () => {
    const result = await run(["marketing"], { code: "CLN-01" });
    expect(JSON.stringify(result.catalogue)).not.toContain("CLN");
  });

  it("refuses every code for a principal with no roles", async () => {
    expect((await run([], { code: "FIN-01" })).refused).toBe(true);
  });
});
