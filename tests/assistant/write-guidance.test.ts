import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/lib/assistant/system-prompt";
import type { ToolContext } from "@/lib/assistant/tools/types";
import type { Principal } from "@/lib/auth/principal";
import { zonedInstantUtc } from "@/lib/domain/timezone";

/**
 * Telling the model it can book appointments when the write tools are off is
 * how a user ends up promised an appointment that was never made. The
 * guidance has to track what is actually on the turn's list.
 */
function context(): ToolContext {
  const principal: Principal = {
    authUserId: "auth-1",
    email: "u@example.com",
    roles: ["owner"],
    aal: "aal2",
    dbUserId: "user-1",
    organizationId: "org-1",
    employeeId: "emp-1",
    displayName: "Nelson",
    isPractitioner: false,
    locale: "es",
    source: "assistant",
  };
  return {
    principal: principal as ToolContext["principal"],
    now: zonedInstantUtc("2026-08-29", 10),
    timeZone: "America/Toronto",
  };
}

describe("the write section of the system prompt", () => {
  it("is absent when the turn has only read tools", () => {
    const prompt = buildSystemPrompt(context(), ["resolve_date", "list_appointments"]);
    expect(prompt).not.toContain("Making changes:");
  });

  it("appears, naming only the write tools actually available", () => {
    const prompt = buildSystemPrompt(context(), [
      "resolve_date",
      "create_appointment",
      "create_patient",
    ]);
    expect(prompt).toContain("Making changes:");
    // The line that names them, not the prompt at large: every tool on the
    // turn is also listed further up, so a plain substring check would pass
    // even if the section named a read tool.
    const named = prompt
      .split("\n")
      .find((line) => line.startsWith("To change anything, call the matching tool:"));
    expect(named).toBe(
      "To change anything, call the matching tool: create_appointment, create_patient.",
    );
  });

  it("says plainly that proposing is not doing", () => {
    const prompt = buildSystemPrompt(context(), ["cancel_appointment"]);
    expect(prompt).toContain("None of these perform the change");
    expect(prompt).toContain("a change is\nnever reported as done");
  });
});
