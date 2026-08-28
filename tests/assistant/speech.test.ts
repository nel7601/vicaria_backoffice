import { describe, expect, it } from "vitest";
import {
  MAX_VOCABULARY_TERMS,
  buildPrompt,
  supportsVerbose,
} from "@/lib/assistant/speech/whisper";

/**
 * The decoding prompt is the whole reason recognition runs server-side: it is
 * what gives the decoder a chance at "Cuco Tetilla".
 *
 * Its shape was settled by measurement, not taste. A bare comma-separated list
 * fixed the names and broke ordinary Spanish — "¿Qué tengo con" came back as
 * "Ke tengo kon" — because the prompt is an example of what the transcript
 * should look like, and the model imitates it. The same names inside a
 * correctly written sentence transcribed all three test phrases perfectly.
 */
describe("buildPrompt", () => {
  const names = ["Cuco Tetilla", "Priya Sharma"];

  it("wraps the names in well-formed prose rather than listing them", () => {
    const prompt = buildPrompt(names);
    expect(prompt).toContain("Cuco Tetilla, Priya Sharma");
    // The correctly written frame is what stops the model copying bad spelling.
    expect(prompt).toContain("ortografía y puntuación correctas");
    expect(prompt).not.toBe("Cuco Tetilla, Priya Sharma");
  });

  it("writes the frame in the language being spoken", () => {
    expect(buildPrompt(names, "en")).toContain("correct spelling and punctuation");
    expect(buildPrompt(names, "en")).not.toContain("ortografía");
  });

  it("drops duplicates rather than weighting a name twice", () => {
    expect(buildPrompt(["Ana Ruiz", "Ana Ruiz", "Luis Paz"])).toContain(
      "Ana Ruiz, Luis Paz",
    );
  });

  it("ignores blanks and stray whitespace", () => {
    expect(buildPrompt(["  Ana Ruiz  ", "", "   "])).toContain("Ana Ruiz");
  });

  it("caps the list instead of letting the provider truncate it", () => {
    const many = Array.from({ length: 200 }, (_, i) => `Patient Number${i}`);
    const listed = buildPrompt(many).split("nombres propios: ")[1] ?? "";
    expect(listed.split(", ").length).toBeLessThanOrEqual(MAX_VOCABULARY_TERMS + 1);
  });

  it("returns nothing at all for an empty vocabulary", () => {
    // No names means no reason to bias the decoder, and an empty frame would
    // still nudge its style for no benefit.
    expect(buildPrompt([])).toBe("");
  });
});

describe("response format by model", () => {
  it("asks for timings only from models that return them", () => {
    expect(supportsVerbose("whisper-1")).toBe(true);
    // The gpt-4o transcribers reject verbose_json outright.
    expect(supportsVerbose("gpt-4o-transcribe")).toBe(false);
    expect(supportsVerbose("gpt-4o-mini-transcribe")).toBe(false);
  });
});
