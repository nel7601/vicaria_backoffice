import { describe, expect, it } from "vitest";
import { hashArguments } from "@/lib/assistant/actions/proposals";

/**
 * The argument hash is what ties a confirmation to the action the user read.
 * If it varies with anything but the values themselves, a legitimate
 * confirmation gets rejected; if it collides across different actions, the
 * check is worthless.
 */
describe("hashArguments", () => {
  const base = {
    appointmentId: "11111111-1111-1111-1111-111111111111",
    startAt: "2026-09-08T19:00:00.000Z",
    endAt: "2026-09-08T20:00:00.000Z",
    patientId: "22222222-2222-2222-2222-222222222222",
  };

  it("is stable across property order", () => {
    const reordered = {
      patientId: base.patientId,
      endAt: base.endAt,
      appointmentId: base.appointmentId,
      startAt: base.startAt,
    };
    expect(hashArguments(reordered)).toBe(hashArguments(base));
  });

  it("changes when the time changes", () => {
    expect(hashArguments({ ...base, startAt: "2026-09-08T20:00:00.000Z" })).not.toBe(
      hashArguments(base),
    );
  });

  it("changes when the patient changes", () => {
    expect(
      hashArguments({ ...base, patientId: "33333333-3333-3333-3333-333333333333" }),
    ).not.toBe(hashArguments(base));
  });

  it("ignores undefined values rather than hashing their absence differently", () => {
    expect(hashArguments({ ...base, employeeId: undefined })).toBe(
      hashArguments(base),
    );
  });

  it("distinguishes nested differences", () => {
    const a = hashArguments({ ...base, extra: { a: 1, b: 2 } });
    const b = hashArguments({ ...base, extra: { a: 1, b: 3 } });
    expect(a).not.toBe(b);
  });

  it("does not confuse a string with a number", () => {
    expect(hashArguments({ hour: 15 })).not.toBe(hashArguments({ hour: "15" }));
  });

  it("produces a sha256-shaped digest", () => {
    expect(hashArguments(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
