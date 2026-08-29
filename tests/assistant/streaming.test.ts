import { describe, expect, it } from "vitest";
import { RESPOND_TOOL, runTurn, type TurnEvent } from "@/lib/assistant/orchestrator";
import { ScriptedProvider } from "@/lib/assistant/provider/scripted";
import type { AiTurnResponse } from "@/lib/assistant/provider/types";
import type { ToolContext } from "@/lib/assistant/tools/types";
import type { Principal } from "@/lib/auth/principal";
import { zonedInstantUtc } from "@/lib/domain/timezone";

/**
 * Streaming exists to fill a wait, and must not change what the turn decides.
 * These pin both halves: the events describe progress, and the outcome is
 * identical to the one a caller who ignores them would get.
 */

function context(overrides: Partial<Principal> = {}): ToolContext {
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
    ...overrides,
  };
  return {
    principal: principal as ToolContext["principal"],
    now: zonedInstantUtc("2026-08-26", 14),
    timeZone: "America/Toronto",
  };
}

const respond = (message: string, spoken?: string): AiTurnResponse => ({
  stopReason: "tool_use",
  text: null,
  toolCalls: [
    {
      id: "c1",
      name: RESPOND_TOOL,
      arguments: { kind: "response", message, ...(spoken ? { spoken } : {}) },
    },
  ],
});

const callTool = (name: string, args: unknown): AiTurnResponse => ({
  stopReason: "tool_use",
  text: null,
  toolCalls: [{ id: `t-${name}`, name, arguments: args }],
});

async function collect(provider: ScriptedProvider, ctx = context()) {
  const events: TurnEvent[] = [];
  const outcome = await runTurn({
    provider,
    ctx,
    input: "¿qué hay el viernes?",
    onEvent: (e) => events.push(e),
  });
  return { events, outcome };
}

describe("what a caller can show while waiting", () => {
  it("announces the tools before running them", async () => {
    const { events } = await collect(
      new ScriptedProvider([
        callTool("resolve_date", { range: { kind: "day", offsetDays: 1 } }),
        respond("Mañana hay dos citas."),
      ]),
    );
    const requested = events.find((e) => e.type === "tools_requested");
    expect(requested).toEqual({ type: "tools_requested", names: ["resolve_date"] });
  });

  it("reports each tool as it finishes", async () => {
    const { events } = await collect(
      new ScriptedProvider([
        callTool("resolve_date", { range: { kind: "day", offsetDays: 1 } }),
        respond("Listo."),
      ]),
    );
    expect(events).toContainEqual({
      type: "tool_done",
      name: "resolve_date",
      ok: true,
    });
  });

  it("says a tool failed rather than going quiet", async () => {
    const { events } = await collect(
      new ScriptedProvider([
        callTool("resolve_date", { range: { kind: "date", date: "el viernes" } }),
        respond("No pude interpretar la fecha."),
      ]),
    );
    expect(events).toContainEqual({
      type: "tool_done",
      name: "resolve_date",
      ok: false,
    });
  });

  it("does not announce respond as work being done", async () => {
    // "Running respond…" would be noise: it is the turn ending, not a lookup.
    // And once filtered there is nothing left, so no event should fire at all
    // — an empty "looking up…" is worse than silence.
    const { events } = await collect(new ScriptedProvider([respond("Hola.")]));
    expect(events.filter((e) => e.type === "tools_requested")).toHaveLength(0);
  });

  it("emits the answer in fragments that reassemble exactly", async () => {
    const message = "El viernes tienes tres citas por la tarde.";
    const { events, outcome } = await collect(
      new ScriptedProvider([respond(message)]),
    );
    const streamed = events
      .filter((e): e is Extract<TurnEvent, { type: "delta" }> => e.type === "delta")
      .map((e) => e.text)
      .join("");
    expect(streamed).toBe(message);
    expect(outcome.message).toBe(message);
  });
});

describe("streaming does not change the answer", () => {
  it("gives the same outcome with and without a listener", async () => {
    const script = () => [
      callTool("resolve_date", { range: { kind: "day", offsetDays: 1 } }),
      respond("Mañana hay dos citas.", "Dos citas mañana."),
    ];
    const { outcome: streamed } = await collect(new ScriptedProvider(script()));
    const plain = await runTurn({
      provider: new ScriptedProvider(script()),
      ctx: context(),
      input: "¿qué hay el viernes?",
    });
    expect(streamed).toEqual(plain);
  });

  it("still refuses when the model never calls respond", async () => {
    const { outcome, events } = await collect(
      new ScriptedProvider([
        { stopReason: "end", text: "Tienes cuatro citas.", toolCalls: [] },
      ]),
    );
    expect(outcome.kind).toBe("refusal");
    // Nothing was streamed, so nothing was shown that the turn then withdrew.
    expect(events.filter((e) => e.type === "delta")).toHaveLength(0);
  });
});

describe("the spoken form", () => {
  it("carries a short version alongside the full one", async () => {
    const { outcome } = await collect(
      new ScriptedProvider([
        respond(
          "El viernes tienes tres citas: 9:00 Amelia Torres, 11:00 Marcus Lee y 15:00 Priya Sharma.",
          "Tienes tres citas el viernes. ¿Te las detallo?",
        ),
      ]),
    );
    expect(outcome.spoken).toBe("Tienes tres citas el viernes. ¿Te las detallo?");
    expect(outcome.message).toContain("Amelia Torres");
    // The point of the split: names stay on screen, not in the air.
    expect(outcome.spoken).not.toContain("Amelia");
  });

  it("leaves it undefined when the model did not shorten anything", async () => {
    const { outcome } = await collect(new ScriptedProvider([respond("Sí.")]));
    expect(outcome.spoken).toBeUndefined();
  });
});
