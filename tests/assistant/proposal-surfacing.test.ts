import { describe, expect, it } from "vitest";
import { readProposal } from "@/lib/assistant/outcome";

/**
 * A proposal is only actionable if it reaches the client whole.
 *
 * The id and the hash live in the model's tool result, which never leaves the
 * server; this is the one place they are lifted out of it. Reading too little
 * leaves the user with a summary and no way to say yes; reading too much —
 * mistaking a refusal or an ordinary tool result for a proposal — puts a
 * confirm button in front of something that was never proposed.
 */
describe("readProposal", () => {
  const good = {
    proposed: true,
    proposalId: "9d2f7a1e-0000-4000-8000-000000000001",
    argumentsHash: "a".repeat(64),
    expiresAt: "2026-08-29T18:00:00.000Z",
    summary: "Agendar cita de Amelia Torres el sábado a las 10:00",
    irreversible: false,
    guidance: "Read the summary back to the user…",
  };

  it("lifts a proposal out of the tool result", () => {
    expect(readProposal(good)).toEqual({
      proposalId: good.proposalId,
      argumentsHash: good.argumentsHash,
      summary: good.summary,
      expiresAt: good.expiresAt,
      irreversible: false,
    });
  });

  it("carries the irreversible mark through", () => {
    expect(readProposal({ ...good, irreversible: true })?.irreversible).toBe(true);
  });

  it("treats a missing mark as reversible rather than assuming the worst", () => {
    const { irreversible: _omit, ...rest } = good;
    expect(readProposal(rest)?.irreversible).toBe(false);
  });

  it("ignores a refused proposal", () => {
    expect(
      readProposal({ proposed: false, reason: "Esa hora ya pasó." }),
    ).toBeUndefined();
  });

  it("ignores the result of an ordinary read tool", () => {
    expect(
      readProposal({ appointments: [{ id: "1", startAt: "2026-08-29T14:00:00Z" }] }),
    ).toBeUndefined();
  });

  it("ignores a proposal missing the hash, which cannot be confirmed anyway", () => {
    const { argumentsHash: _omit, ...rest } = good;
    expect(readProposal(rest)).toBeUndefined();
  });

  it("ignores anything that is not an object", () => {
    for (const value of [null, undefined, "proposed", 42, [good]]) {
      expect(readProposal(value)).toBeUndefined();
    }
  });
});
