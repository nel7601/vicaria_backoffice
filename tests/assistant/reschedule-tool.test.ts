import { describe, expect, it } from "vitest";
import { findTool, toolsFor } from "@/lib/assistant/tools/registry";
import type { Principal } from "@/lib/auth/principal";
import type { Role } from "@/lib/auth/rbac";

/**
 * The write tools must be unreachable unless deliberately switched on, and
 * unreachable for roles that cannot change appointments. Their execution path
 * needs a database; what is asserted here is who can see them at all.
 *
 * Reschedule is now generated from the action catalogue like every other
 * write, so it is looked up by name rather than imported — which also checks
 * that generation actually produced it.
 */

/** The generated tool, looked up the way the orchestrator sees it. */
function reschedule() {
  const tool = findTool("reschedule_appointment");
  if (!tool) throw new Error("reschedule_appointment was not generated");
  return tool;
}

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

const FLAGS = [
  "ASSISTANT_ENABLED",
  "ASSISTANT_WRITE_ACTIONS_ENABLED",
  "ASSISTANT_RESCHEDULE_ENABLED",
];

function withFlags(on: boolean, fn: () => void) {
  for (const f of FLAGS) {
    if (on) process.env[f] = "on";
    else delete process.env[f];
  }
  try {
    fn();
  } finally {
    for (const f of FLAGS) delete process.env[f];
  }
}

describe("the write tool stays switched off by default", () => {
  it("is not offered when the flags are unset", () => {
    withFlags(false, () => {
      expect(toolsFor(principal(["owner"])).map((t) => t.name)).not.toContain(
        "reschedule_appointment",
      );
    });
  });

  it("is offered to an owner only with every flag on", () => {
    withFlags(true, () => {
      expect(toolsFor(principal(["owner"])).map((t) => t.name)).toContain(
        "reschedule_appointment",
      );
    });
  });

  it("stays hidden when only the outer write flag is on", () => {
    process.env.ASSISTANT_ENABLED = "on";
    process.env.ASSISTANT_WRITE_ACTIONS_ENABLED = "on";
    try {
      expect(reschedule().isAvailable?.(principal(["owner"]))).toBe(false);
    } finally {
      delete process.env.ASSISTANT_ENABLED;
      delete process.env.ASSISTANT_WRITE_ACTIONS_ENABLED;
    }
  });
});

describe("who may propose a move", () => {
  it("is hidden from a role that cannot update appointments", () => {
    withFlags(true, () => {
      // Marketing and auditor read; neither may change an appointment.
      for (const role of ["marketing", "auditor"] as Role[]) {
        expect(
          reschedule().isAvailable?.(principal([role])),
          role,
        ).toBe(false);
      }
    });
  });

  it("is hidden while MFA is outstanding for a privileged role", () => {
    withFlags(true, () => {
      expect(
        reschedule().isAvailable?.(
          principal(["owner"], { aal: "aal1" }),
        ),
      ).toBe(false);
    });
  });

  it("declares update, not read", () => {
    expect(reschedule().action).toBe("update");
  });
});

describe("its schema refuses ambiguity", () => {
  const parse = (v: unknown) => reschedule().input.safeParse(v);
  const valid = {
    appointmentId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    day: "2026-09-08",
    hour: 15,
  };

  it("accepts an absolute day and a 24-hour time", () => {
    expect(parse(valid).success).toBe(true);
  });

  it("rejects an id that is not a real uuid", () => {
    // Zod 4 checks the variant, not just the shape, so a made-up
    // 1111-1111 string does not slip through as an appointment id.
    expect(parse({ ...valid, appointmentId: "11111111-1111-1111-1111-111111111111" }).success).toBe(false);
  });

  it("rejects a spoken day", () => {
    expect(parse({ ...valid, day: "next tuesday" }).success).toBe(false);
  });

  it("rejects an hour outside the clock", () => {
    expect(parse({ ...valid, hour: 25 }).success).toBe(false);
    // 3 could be 3am or 3pm; the model must resolve that with the user, but
    // 3 itself is a legitimate hour and the schema cannot catch the ambiguity.
    expect(parse({ ...valid, hour: 3 }).success).toBe(true);
  });

  it("rejects an appointment described instead of identified", () => {
    expect(parse({ ...valid, appointmentId: "the one on saturday" }).success).toBe(
      false,
    );
  });
});
