import { describe, expect, it } from "vitest";
import {
  ToolInputError,
  ToolNotAvailableError,
  canUseTool,
  findTool,
  invokeTool,
  toolsFor,
} from "@/lib/assistant/tools/registry";
import type { ToolContext } from "@/lib/assistant/tools/types";
import type { Principal } from "@/lib/auth/principal";
import type { Role } from "@/lib/auth/rbac";
import { zonedInstantUtc } from "@/lib/domain/timezone";

/**
 * The catalogue is the containment boundary (§5): the model can only ask for
 * these names, only with valid arguments, and only when its roles allow it.
 * Offering and authorising are checked separately, so a name that arrives by
 * some other route still has to pass.
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

function context(p: Principal): ToolContext {
  return {
    principal: p as ToolContext["principal"],
    now: zonedInstantUtc("2026-08-26", 14),
    timeZone: "America/Toronto",
  };
}

describe("what each role is offered", () => {
  it("offers an owner the whole catalogue", () => {
    const names = toolsFor(principal(["owner"])).map((t) => t.name);
    expect(names).toContain("get_appointments_for_range");
    expect(names).toContain("count_completed_appointments");
    expect(names).toContain("resolve_date");
  });

  it("still offers date arithmetic to a role with no data access", () => {
    // resolve_date reads nothing, so withholding it only makes the agent worse
    // at stating the date it is refusing about.
    const names = toolsFor(principal([])).map((t) => t.name);
    expect(names).toEqual(["resolve_date"]);
  });

  it("withholds patient tools from a role that cannot read patients", () => {
    const names = toolsFor(principal([])).map((t) => t.name);
    expect(names).not.toContain("get_appointments_for_range");
  });

  it("withholds everything but dates while MFA is outstanding", () => {
    const names = toolsFor(principal(["owner"], { aal: "aal1" })).map((t) => t.name);
    expect(names).toEqual(["resolve_date"]);
  });
});

describe("invocation is re-checked, not trusted", () => {
  it("refuses a tool the principal was never offered", async () => {
    await expect(
      invokeTool("get_appointments_for_range", { range: { kind: "day", offsetDays: 0 } }, context(principal([]))),
    ).rejects.toBeInstanceOf(ToolNotAvailableError);
  });

  it("refuses a tool that does not exist", async () => {
    await expect(
      invokeTool("run_sql", { query: "select 1" }, context(principal(["owner"]))),
    ).rejects.toBeInstanceOf(ToolNotAvailableError);
  });

  it("reports an unknown tool and a forbidden one identically", async () => {
    const message = async (name: string): Promise<string> => {
      try {
        await invokeTool(name, {}, context(principal([])));
        return "no error";
      } catch (e) {
        return (e as Error).message;
      }
    };
    const forbidden = await message("get_appointments_for_range");
    const unknown = await message("no_such_tool");
    // Both say "not available for this user": which tools exist for other
    // roles is not something a caller gets to learn by probing.
    expect(forbidden.replace("get_appointments_for_range", "X")).toBe(
      unknown.replace("no_such_tool", "X"),
    );
  });

  it("rejects arguments that fail the schema before running anything", async () => {
    await expect(
      invokeTool("resolve_date", { range: { kind: "weekday", weekday: "someday", direction: "next" } }, context(principal(["owner"]))),
    ).rejects.toBeInstanceOf(ToolInputError);
  });

  it("names the offending field so the model can correct itself", async () => {
    let issues: string[] = [];
    try {
      await invokeTool(
        "resolve_date",
        { range: { kind: "date", date: "next friday" } },
        context(principal(["owner"])),
      );
    } catch (e) {
      issues = (e as ToolInputError).issues;
    }
    expect(issues.join(" ")).toContain("date");
  });
});

describe("the date tool end to end", () => {
  it("resolves a weekday against the clinic's current day", async () => {
    const result = (await invokeTool(
      "resolve_date",
      { range: { kind: "weekday", weekday: "friday", direction: "next" } },
      context(principal(["reception"])),
    )) as { startDay: string; resolvedFrom: { today: string } };
    expect(result.startDay).toBe("2026-08-28");
    expect(result.resolvedFrom.today).toBe("2026-08-26");
  });
});

describe("catalogue shape", () => {
  it("exposes no tool that takes free-form queries", () => {
    for (const name of ["run_sql", "query", "fetch", "http_get", "shell"]) {
      expect(findTool(name)).toBeUndefined();
    }
  });

  it("keeps every data tool away from a principal with no roles", () => {
    for (const tool of toolsFor(principal(["owner"]))) {
      if (tool.name === "resolve_date") continue;
      // Either a resource gates it, or it gates itself (run_report).
      expect(tool.resource ?? tool.isAvailable, tool.name).toBeTruthy();
      expect(canUseTool(principal([]), tool), tool.name).toBe(false);
    }
  });
});
