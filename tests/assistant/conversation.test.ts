import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONVERSATION_TTL_MS,
  ConversationKeyMissing,
  MAX_HISTORY_MESSAGES,
  conversationMemoryAvailable,
  extendConversation,
  openConversation,
  sealConversation,
} from "@/lib/assistant/conversation";
import type { AiMessage } from "@/lib/assistant/provider/types";

/**
 * The history travels through the client, so it is treated as hostile input on
 * the way back: encrypted so it cannot be read, authenticated so it cannot be
 * edited, and bound to a user so it cannot be borrowed.
 *
 * Every failure here has to degrade to "no memory", never to a thrown turn —
 * forgetting costs a repeated question, failing costs the answer.
 */

const KEY = "test-key-for-sealing-conversations";
const USER = "auth-user-1";
const OTHER = "auth-user-2";

const history: AiMessage[] = [
  { role: "user", content: "¿qué citas hay este mes?" },
  { role: "assistant", content: "Hay 10 citas." },
];

beforeEach(() => {
  process.env.ASSISTANT_CONVERSATION_KEY = KEY;
});
afterEach(() => {
  delete process.env.ASSISTANT_CONVERSATION_KEY;
});

describe("carrying a conversation", () => {
  it("round-trips what was said", () => {
    const sealed = sealConversation(USER, history);
    expect(openConversation(USER, sealed)).toEqual(history);
  });

  it("produces something the client cannot read", () => {
    const sealed = sealConversation(USER, history);
    expect(sealed).not.toContain("citas");
    expect(Buffer.from(sealed, "base64url").toString("utf8")).not.toContain(
      "citas",
    );
  });

  it("differs every time, so two identical histories are not linkable", () => {
    expect(sealConversation(USER, history)).not.toBe(
      sealConversation(USER, history),
    );
  });

  it("adds an exchange without losing the earlier ones", () => {
    const first = sealConversation(USER, history);
    const second = extendConversation(USER, first, "¿y el viernes?", "Ninguna.");
    const opened = openConversation(USER, second);
    expect(opened).toHaveLength(4);
    expect(opened[2]).toEqual({ role: "user", content: "¿y el viernes?" });
  });

  it("starts a conversation when there is nothing to extend", () => {
    const sealed = extendConversation(USER, undefined, "hola", "hola");
    expect(openConversation(USER, sealed)).toHaveLength(2);
  });

  it("does not record an empty reply as a turn", () => {
    const sealed = extendConversation(USER, undefined, "hola", "");
    expect(openConversation(USER, sealed)).toEqual([
      { role: "user", content: "hola" },
    ]);
  });
});

describe("what it refuses", () => {
  it("will not open another user's conversation", () => {
    // The user id is authenticated, so knowing the blob is not enough.
    const sealed = sealConversation(USER, history);
    expect(openConversation(OTHER, sealed)).toEqual([]);
  });

  it("rejects a tampered blob rather than trusting it", () => {
    const sealed = sealConversation(USER, history);
    const raw = Buffer.from(sealed, "base64url");
    raw[raw.length - 1] ^= 0xff;
    expect(openConversation(USER, raw.toString("base64url"))).toEqual([]);
  });

  it("rejects a blob sealed with a different key", () => {
    const sealed = sealConversation(USER, history);
    process.env.ASSISTANT_CONVERSATION_KEY = "a-completely-different-key";
    // What rotating the key costs: conversations in flight start over.
    expect(openConversation(USER, sealed)).toEqual([]);
  });

  it("forgets once it has gone stale", () => {
    const t0 = 1_000_000;
    const sealed = sealConversation(USER, history, t0);
    expect(openConversation(USER, sealed, t0 + 1000)).toHaveLength(2);
    expect(openConversation(USER, sealed, t0 + CONVERSATION_TTL_MS + 1)).toEqual(
      [],
    );
  });

  it("returns nothing for junk instead of throwing", () => {
    for (const junk of ["", "not-base64!!", "aGVsbG8", "x".repeat(500)]) {
      expect(openConversation(USER, junk)).toEqual([]);
    }
  });

  it("ignores an absurdly large blob without parsing it", () => {
    expect(openConversation(USER, "A".repeat(200_000))).toEqual([]);
  });

  it("caps what it carries forward", () => {
    let sealed: string | undefined;
    for (let i = 0; i < 40; i++) {
      sealed = extendConversation(USER, sealed, `pregunta ${i}`, `respuesta ${i}`);
    }
    const opened = openConversation(USER, sealed);
    expect(opened.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
    expect(JSON.stringify(opened)).toContain("pregunta 39");
    expect(JSON.stringify(opened)).not.toContain("pregunta 0");
  });
});

describe("when no key is configured", () => {
  beforeEach(() => {
    delete process.env.ASSISTANT_CONVERSATION_KEY;
  });

  it("reports that memory is unavailable", () => {
    expect(conversationMemoryAvailable()).toBe(false);
  });

  it("opens nothing rather than failing a turn", () => {
    expect(openConversation(USER, "anything")).toEqual([]);
  });

  it("refuses to seal, so nothing is handed out unprotected", () => {
    // Sealing is the one place that must not degrade quietly: returning
    // plaintext would put the conversation in the client's hands.
    expect(() => sealConversation(USER, history)).toThrow(ConversationKeyMissing);
  });
});
