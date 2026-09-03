import { describe, expect, it } from "vitest";
import { labelForPath, parseReturnTo } from "@/lib/nav/return-to";

describe("parseReturnTo", () => {
  it("accepts an in-app path and names it", () => {
    expect(parseReturnTo("/encounters/abc-123")).toEqual({
      href: "/encounters/abc-123",
      label: "Encounter",
    });
  });

  it("keeps a query string, so a tab or a month survives the round trip", () => {
    const parsed = parseReturnTo("/patients/p1/record?tab=t1");
    expect(parsed?.href).toBe("/patients/p1/record?tab=t1");
    expect(parsed?.label).toBe("Clinical record");
  });

  it("rejects anything that could leave the app", () => {
    // An unchecked ?from= is an open redirect: a link mailed to a clinician
    // would carry them off-site from inside the record.
    for (const hostile of [
      "https://evil.example/steal",
      "//evil.example",
      "/\\evil.example",
      "/patients\\..\\evil",
      "javascript:alert(1)",
      "evil.example",
      "",
      "   ",
    ]) {
      expect(parseReturnTo(hostile), hostile).toBeNull();
    }
  });

  it("rejects a missing value and an absurdly long one", () => {
    expect(parseReturnTo(undefined)).toBeNull();
    expect(parseReturnTo(null)).toBeNull();
    expect(parseReturnTo(`/${"a".repeat(600)}`)).toBeNull();
  });
});

describe("labelForPath", () => {
  it("names the views a record can be opened from", () => {
    expect(labelForPath("/encounters/1")).toBe("Encounter");
    expect(labelForPath("/encounters")).toBe("Encounters");
    expect(labelForPath("/billing/1")).toBe("Invoice");
    expect(labelForPath("/billing")).toBe("Billing");
    expect(labelForPath("/calendar/1")).toBe("Appointment");
    expect(labelForPath("/care/schedule")).toBe("Care schedule");
    expect(labelForPath("/care/1")).toBe("Care agreement");
    expect(labelForPath("/care")).toBe("Home care");
    expect(labelForPath("/patients/1/record")).toBe("Clinical record");
    expect(labelForPath("/patients/1")).toBe("Patient profile");
    expect(labelForPath("/patients")).toBe("Patients");
  });

  it("falls back to a neutral word for anything unlisted", () => {
    expect(labelForPath("/somewhere-new")).toBe("Back");
  });
});
