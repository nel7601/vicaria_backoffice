import { describe, expect, it } from "vitest";
import {
  findDuplicates,
  formatPatientNumber,
  normalizeEmail,
  normalizeName,
  normalizePhone,
} from "@/lib/domain/patient";

describe("normalization (§FR-PAT-001)", () => {
  it("normalizes email", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(normalizeEmail("")).toBeNull();
  });

  it("normalizes names", () => {
    expect(normalizeName("  María   García ")).toBe("María García");
    expect(normalizeName("   ")).toBeNull();
  });

  it("normalizes phones to E.164", () => {
    expect(normalizePhone("(416) 555-1234")).toBe("+14165551234");
    expect(normalizePhone("1-416-555-1234")).toBe("+14165551234");
    expect(normalizePhone("+52 55 1234 5678")).toBe("+525512345678");
    expect(normalizePhone("abc")).toBeNull();
  });

  it("formats patient numbers", () => {
    expect(formatPatientNumber(1)).toBe("P-0001");
    expect(formatPatientNumber(1234)).toBe("P-1234");
  });
});

describe("duplicate detection (§FR-PAT-002)", () => {
  const existing = [
    {
      id: "a",
      email: "ada@example.com",
      phoneE164: "+14165551234",
      legalFirstName: "Ada",
      legalLastName: "Lovelace",
      dateOfBirth: "1990-01-01",
    },
    {
      id: "b",
      email: "other@example.com",
      phoneE164: "+15195550000",
      legalFirstName: "Bob",
      legalLastName: "Jones",
      dateOfBirth: "1985-05-05",
    },
  ];

  it("matches on email", () => {
    const m = findDuplicates({ email: "ADA@example.com" }, existing);
    expect(m).toHaveLength(1);
    expect(m[0].id).toBe("a");
    expect(m[0].reasons).toContain("email");
  });

  it("matches on phone with different formatting", () => {
    const m = findDuplicates({ phoneE164: "(416) 555-1234" }, existing);
    expect(m[0].id).toBe("a");
    expect(m[0].reasons).toContain("phone");
  });

  it("matches on name + DOB together", () => {
    const m = findDuplicates(
      { legalFirstName: "ada", legalLastName: "lovelace", dateOfBirth: "1990-01-01" },
      existing,
    );
    expect(m[0].id).toBe("a");
    expect(m[0].reasons).toContain("name_dob");
  });

  it("does not match on name alone without DOB", () => {
    const m = findDuplicates(
      { legalFirstName: "Ada", legalLastName: "Lovelace" },
      existing,
    );
    expect(m).toHaveLength(0);
  });

  it("returns nothing when there is no match", () => {
    expect(findDuplicates({ email: "nobody@example.com" }, existing)).toHaveLength(
      0,
    );
  });
});
