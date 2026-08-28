import { describe, expect, it } from "vitest";
import {
  MAX_VOCABULARY_TERMS,
  buildPrompt,
} from "@/lib/assistant/speech/whisper";

/**
 * The vocabulary prompt is the whole reason recognition runs server-side: it
 * is what gives the decoder a chance at "Cuco Tetilla". Whisper truncates the
 * prompt silently past its cap, so the bounding happens here where it can be
 * seen rather than in the results where it cannot.
 */
describe("buildPrompt", () => {
  it("joins names the way the decoder expects", () => {
    expect(buildPrompt(["Cuco Tetilla", "Priya Sharma"])).toBe(
      "Cuco Tetilla, Priya Sharma",
    );
  });

  it("drops duplicates rather than weighting a name twice", () => {
    expect(buildPrompt(["Ana Ruiz", "Ana Ruiz", "Luis Paz"])).toBe(
      "Ana Ruiz, Luis Paz",
    );
  });

  it("ignores blanks and stray whitespace", () => {
    expect(buildPrompt(["  Ana Ruiz  ", "", "   "])).toBe("Ana Ruiz");
  });

  it("caps the list instead of letting the provider truncate it", () => {
    const many = Array.from({ length: 200 }, (_, i) => `Patient Number${i}`);
    const prompt = buildPrompt(many);
    expect(prompt.split(", ")).toHaveLength(MAX_VOCABULARY_TERMS);
  });

  it("keeps the earliest names, which are the most likely to be spoken", () => {
    const many = Array.from({ length: 100 }, (_, i) => `Name${i}`);
    expect(buildPrompt(many)).toContain("Name0");
    expect(buildPrompt(many)).not.toContain("Name99");
  });

  it("returns nothing for an empty vocabulary", () => {
    expect(buildPrompt([])).toBe("");
  });
});
