import { describe, expect, it } from "vitest";
import { PartialStringField } from "@/lib/assistant/provider/partial-json";

/**
 * This is what lets the answer be spoken as it is written instead of after it
 * is finished. It reads a field out of JSON that is still arriving, so every
 * case here is a fragment boundary landing somewhere awkward.
 */

function feed(field: string, chunks: string[]): string {
  const reader = new PartialStringField(field);
  return chunks.map((c) => reader.push(c)).join("");
}

describe("reading a field as it arrives", () => {
  it("emits text before the JSON is complete", () => {
    const reader = new PartialStringField("message");
    expect(reader.push('{"kind":"response","message":"You have th')).toBe(
      "You have th",
    );
    expect(reader.push("ree appointments")).toBe("ree appointments");
    expect(reader.finished).toBe(false);
  });

  it("stops at the closing quote and ignores what follows", () => {
    const reader = new PartialStringField("message");
    reader.push('{"message":"Done');
    expect(reader.push('","spoken":"Short"}')).toBe("");
    expect(reader.finished).toBe(true);
  });

  it("survives the key itself being split across chunks", () => {
    expect(feed("message", ['{"mes', 'sage":"hi', ' there"}'])).toBe("hi there");
  });

  it("survives the opening quote arriving separately", () => {
    expect(feed("message", ['{"message":', '"hello"}'])).toBe("hello");
  });

  it("yields nothing until its field appears", () => {
    const reader = new PartialStringField("message");
    expect(reader.push('{"kind":"response",')).toBe("");
    expect(reader.push('"message":"now"}')).toBe("now");
  });

  it("returns nothing at all when the field never appears", () => {
    expect(feed("message", ['{"kind":"refusal"}'])).toBe("");
  });
});

describe("escapes", () => {
  it("decodes the common ones", () => {
    expect(feed("m", ['{"m":"line\\none\\ttab"}'])).toBe("line\none\ttab");
  });

  it("keeps a quoted quote inside the value", () => {
    expect(feed("m", ['{"m":"say \\"hi\\" now"}'])).toBe('say "hi" now');
  });

  it("does not mistake an escaped quote for the end", () => {
    const reader = new PartialStringField("m");
    reader.push('{"m":"a\\"b"}');
    expect(reader.finished).toBe(true);
  });

  it("waits rather than decoding half an escape", () => {
    const reader = new PartialStringField("m");
    // A lone backslash could become \n, \", or anything: emitting now would
    // print a stray character that is not in the answer.
    expect(reader.push('{"m":"hola\\')).toBe("hola");
    expect(reader.push('nmundo"}')).toBe("\nmundo");
  });

  it("waits for a whole unicode escape, then emits what it decoded", () => {
    const reader = new PartialStringField("m");
    // Accented names arrive escaped. Half of \u00ed must not print garbage,
    // and once the rest lands the decoded character is what comes out.
    expect(reader.push('{"m":"Mart\\u00')).toBe("Mart");
    expect(reader.push('edn"}')).toBe("ín");
    expect(reader.finished).toBe(true);
  });

  it("never emits the same text twice across chunks", () => {
    const reader = new PartialStringField("m");
    const a = reader.push('{"m":"abc');
    const b = reader.push("def");
    const c = reader.push('ghi"}');
    expect(a + b + c).toBe("abcdefghi");
    expect([a, b, c]).toEqual(["abc", "def", "ghi"]);
  });
});
