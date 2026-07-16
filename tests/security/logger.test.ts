import { describe, expect, it } from "vitest";
import { redact } from "@/lib/observability/logger";

describe("PHI redaction (SEC-06)", () => {
  it("drops sensitive keys", () => {
    const out = redact({
      email: "ada@example.com",
      legal_first_name: "Ada",
      summary: "sensitive clinical note",
      status: "active",
    }) as Record<string, unknown>;
    expect(out.email).toBe("[redacted]");
    expect(out.legal_first_name).toBe("[redacted]");
    expect(out.summary).toBe("[redacted]");
    expect(out.status).toBe("active");
  });

  it("masks emails and phones in free text", () => {
    expect(redact("contact ada@example.com now")).toBe("contact [email] now");
    expect(redact("call +1 416-555-1234 today")).toBe("call [phone] today");
  });

  it("recurses into nested structures", () => {
    const out = redact({ patient: { email: "x@y.com", note: "hi" }, ok: [1, 2] }) as {
      patient: Record<string, unknown>;
      ok: number[];
    };
    expect(out.patient.email).toBe("[redacted]");
    expect(out.patient.note).toBe("[redacted]");
    expect(out.ok).toEqual([1, 2]);
  });
});
