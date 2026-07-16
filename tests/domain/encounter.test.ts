import { describe, expect, it } from "vitest";
import {
  canAmend,
  canonicalJson,
  canSign,
  computeContentHash,
  isImmutable,
  validateAnswers,
  type TemplateSchema,
} from "@/lib/domain/encounter";

describe("content hashing (§FR-ENC-003)", () => {
  it("is order-independent over object keys", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("produces a stable hash for equal content", () => {
    const h1 = computeContentHash({ a: 1, b: [2, 3] }, "summary");
    const h2 = computeContentHash({ b: [2, 3], a: 1 }, "summary");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("changes when content changes", () => {
    expect(computeContentHash({ a: 1 }, "s")).not.toBe(
      computeContentHash({ a: 2 }, "s"),
    );
  });
});

describe("immutability guards (§FR-ENC-004)", () => {
  it("only drafts can be signed", () => {
    expect(canSign("draft")).toBe(true);
    expect(canSign("signed")).toBe(false);
    expect(canSign("amended")).toBe(false);
  });

  it("signed/amended notes are immutable and amendable", () => {
    expect(isImmutable("signed")).toBe(true);
    expect(isImmutable("amended")).toBe(true);
    expect(isImmutable("draft")).toBe(false);
    expect(canAmend("signed")).toBe(true);
    expect(canAmend("draft")).toBe(false);
  });
});

describe("template validation (§FR-ENC-002)", () => {
  const schema: TemplateSchema = {
    fields: [
      { key: "chief", label: "Chief complaint", type: "text", required: true },
      { key: "pain", label: "Pain", type: "scale", min: 0, max: 10 },
      { key: "mood", label: "Mood", type: "select", options: ["good", "bad"] },
    ],
  };

  it("flags missing required fields", () => {
    const r = validateAnswers(schema, {});
    expect(r.ok).toBe(false);
    expect(r.errors.chief).toBeDefined();
  });

  it("enforces scale bounds", () => {
    const r = validateAnswers(schema, { chief: "x", pain: 12 });
    expect(r.ok).toBe(false);
    expect(r.errors.pain).toContain("≤ 10");
  });

  it("rejects invalid select options", () => {
    const r = validateAnswers(schema, { chief: "x", mood: "meh" });
    expect(r.ok).toBe(false);
    expect(r.errors.mood).toBeDefined();
  });

  it("accepts a valid set of answers", () => {
    const r = validateAnswers(schema, { chief: "headache", pain: 5, mood: "good" });
    expect(r.ok).toBe(true);
  });
});
