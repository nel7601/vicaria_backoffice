/**
 * Reads one string field out of JSON that is still arriving.
 *
 * The final answer reaches us inside a tool call's arguments, which stream as
 * fragments of JSON: `{"kind":"resp`, `onse","message":"You have th`, and so
 * on. Waiting for valid JSON means waiting for the whole answer, which is
 * exactly the silence this is meant to remove. So the field is read as it is
 * written.
 *
 * Deliberately not a JSON parser. It looks for one key, tracks whether it is
 * inside that key's string value, and unescapes as it goes — enough to show
 * text early, and it simply yields nothing on anything it does not recognise.
 * The authoritative parse still happens on the complete arguments.
 */
export class PartialStringField {
  private buffer = "";
  private emitted = 0;
  private start = -1;
  private done = false;

  constructor(private readonly field: string) {}

  /**
   * Feed the next fragment; get back whatever is newly readable.
   *
   * Returns "" rather than throwing when the field has not begun, has already
   * ended, or the buffer stops mid-escape — a partial `á` would decode to
   * garbage, so it waits for the rest.
   */
  push(chunk: string): string {
    if (this.done) return "";
    this.buffer += chunk;

    if (this.start < 0) {
      const marker = `"${this.field}"`;
      const at = this.buffer.indexOf(marker);
      if (at < 0) return "";
      // Skip past the key, its colon and the opening quote of the value.
      const quote = this.buffer.indexOf('"', at + marker.length + 1);
      if (quote < 0) return "";
      this.start = quote + 1;
    }

    const { text, closed, consumed } = scan(this.buffer, this.start);
    if (closed) this.done = true;

    // `consumed` marks the last position that decoded cleanly; anything after
    // it is a half-written escape sequence waiting for more input.
    void consumed;

    const fresh = text.slice(this.emitted);
    this.emitted = text.length;
    return fresh;
  }

  /** True once the field's closing quote has been seen. */
  get finished(): boolean {
    return this.done;
  }
}

/** Decode a JSON string body from `from` until its unescaped closing quote. */
function scan(
  buffer: string,
  from: number,
): { text: string; closed: boolean; consumed: number } {
  let out = "";
  let i = from;

  while (i < buffer.length) {
    const ch = buffer[i];

    if (ch === '"') return { text: out, closed: true, consumed: i };

    if (ch !== "\\") {
      out += ch;
      i += 1;
      continue;
    }

    // An escape needs its following character, and \u needs four more.
    const next = buffer[i + 1];
    if (next === undefined) break;
    if (next === "u") {
      if (i + 6 > buffer.length) break;
      const code = buffer.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(code)) break;
      out += String.fromCharCode(parseInt(code, 16));
      i += 6;
      continue;
    }

    out += UNESCAPE[next] ?? next;
    i += 2;
  }

  return { text: out, closed: false, consumed: i };
}

const UNESCAPE: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  '"': '"',
  "\\": "\\",
  "/": "/",
};
