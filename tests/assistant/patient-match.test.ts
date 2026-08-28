import { describe, expect, it } from "vitest";
import {
  CONFIDENT_MATCH,
  classifyMatches,
  looksLikeNumber,
  nameScore,
  normalizeName,
  normalizeNumber,
} from "@/lib/assistant/tools/patient-match";

/**
 * These rules decide which patient the agent thinks the user meant. The
 * asymmetry runs through all of it: an unnecessary question costs a second,
 * acting on the wrong patient is not undone by apologising.
 */

describe("normalizing what was heard", () => {
  it("folds accents so Martin finds Martín", () => {
    expect(normalizeName("Martín")).toBe("martin");
    expect(normalizeName("MARTÍN SUÁREZ")).toBe("martin suarez");
  });

  it("collapses the punctuation speech recognition invents", () => {
    expect(normalizeName("  María,  José . ")).toBe("maria jose");
  });

  it("keeps the hyphens and apostrophes that belong to names", () => {
    expect(normalizeName("O'Brien-Smith")).toBe("o'brien-smith");
  });

  it("strips separators from a spoken patient number", () => {
    expect(normalizeNumber("P-1042")).toBe("p1042");
    expect(normalizeNumber("p 10 42")).toBe("p1042");
  });
});

describe("telling a number from a name", () => {
  it("recognises patient numbers", () => {
    for (const value of ["P-1042", "1042", "VIC-0007"]) {
      expect(looksLikeNumber(value), value).toBe(true);
    }
  });

  it("does not mistake a name for a number", () => {
    for (const value of ["Ana", "Cuco", "María José", "Lee"]) {
      expect(looksLikeNumber(value), value).toBe(false);
    }
  });
});

describe("scoring a spoken name", () => {
  it("gives an exact match full confidence", () => {
    expect(nameScore("Cuco Pérez", "Cuco Perez")).toBe(1);
  });

  it("matches a first name against a full name", () => {
    expect(nameScore("Cuco", "Cuco Pérez")).toBeGreaterThanOrEqual(0.9);
  });

  it("tolerates the kind of slip speech recognition makes", () => {
    // "Fournier" heard as "Fournie".
    expect(nameScore("Daniel Fournie", "Daniel Fournier")).toBeGreaterThan(0.5);
  });

  it("finds a first name the recogniser mangled, despite the surname", () => {
    // Regression: scoring "Prya" against "priya sharma" as one string buries
    // the near miss under the surname's trigrams and the patient is not found
    // at all. Each part has to be compared separately.
    const score = nameScore("Prya", "Priya Sharma");
    expect(score).toBeGreaterThan(0.3);
    // Still not confident enough to resolve silently: it should ask.
    expect(score).toBeLessThan(CONFIDENT_MATCH);
  });

  it("keeps a full spoken name scored against the full name", () => {
    expect(nameScore("Priya Sharma", "Priya Sharma")).toBe(1);
  });

  it("does not confidently equate two different short names", () => {
    // The failure to avoid: "Ana" and "Ann" are not the same person.
    expect(nameScore("Ana", "Ann")).toBeLessThan(CONFIDENT_MATCH);
  });

  it("scores unrelated names near zero", () => {
    expect(nameScore("Cuco", "Harold Bennett")).toBeLessThan(0.3);
  });
});

describe("deciding whether it is resolved", () => {
  const c = (score: number, id = String(score)) => ({ score, id });

  it("resolves a single confident match", () => {
    expect(classifyMatches([c(1)])).toMatchObject({ status: "one" });
  });

  it("asks when two patients both match well", () => {
    // Two people called Ana García: no score justifies picking one.
    const result = classifyMatches([c(1, "a"), c(1, "b")]);
    expect(result.status).toBe("many");
    expect(result.matches).toHaveLength(2);
  });

  it("asks when the best match is not confident enough", () => {
    expect(classifyMatches([c(0.6)]).status).toBe("many");
  });

  it("resolves when the winner is clearly ahead", () => {
    expect(classifyMatches([c(0.95), c(0.4)]).status).toBe("one");
  });

  it("asks when the winner is only narrowly ahead", () => {
    expect(classifyMatches([c(0.95), c(0.9)]).status).toBe("many");
  });

  it("reports nothing when everything is noise", () => {
    expect(classifyMatches([c(0.1), c(0.05)])).toMatchObject({
      status: "none",
      matches: [],
    });
  });

  it("caps how many candidates it offers", () => {
    const many = Array.from({ length: 12 }, (_, i) => c(0.5, `p${i}`));
    expect(classifyMatches(many).matches.length).toBeLessThanOrEqual(5);
  });
});
