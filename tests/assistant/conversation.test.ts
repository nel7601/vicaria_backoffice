import { beforeEach, describe, expect, it } from "vitest";
import {
  CONVERSATION_TTL_MS,
  MAX_HISTORY_MESSAGES,
  appendExchange,
  forgetConversation,
  loadConversation,
  resetConversations,
} from "@/lib/assistant/conversation";

/**
 * Conversation memory is what lets someone say "and next week?" instead of
 * repeating themselves. It is also, by construction, a store of things people
 * said about patients — so what it forgets, and who it refuses to show, matter
 * as much as what it remembers.
 */

beforeEach(() => resetConversations());

describe("remembering a conversation", () => {
  it("returns nothing for a conversation that never happened", () => {
    expect(loadConversation("user-1", "c1")).toEqual([]);
  });

  it("gives back the exchange in order", () => {
    appendExchange("user-1", "c1", "what's on friday?", "Three appointments.");
    expect(loadConversation("user-1", "c1")).toEqual([
      { role: "user", content: "what's on friday?" },
      { role: "assistant", content: "Three appointments." },
    ]);
  });

  it("accumulates across turns so a follow-up has context", () => {
    appendExchange("user-1", "c1", "what's on friday?", "Three appointments.");
    appendExchange("user-1", "c1", "and next week?", "Eleven.");
    const history = loadConversation("user-1", "c1");
    expect(history).toHaveLength(4);
    expect(history[2]).toEqual({ role: "user", content: "and next week?" });
  });

  it("keeps conversations apart", () => {
    appendExchange("user-1", "c1", "friday?", "Three.");
    appendExchange("user-1", "c2", "invoices?", "Five outstanding.");
    expect(loadConversation("user-1", "c1")).toHaveLength(2);
    expect(loadConversation("user-1", "c2")[0]).toEqual({
      role: "user",
      content: "invoices?",
    });
  });
});

describe("what it refuses to share", () => {
  it("does not hand one user another user's conversation", () => {
    // A conversation id is not a capability: knowing it must not be enough.
    appendExchange("user-1", "shared-id", "Amelia's balance?", "Zero.");
    expect(loadConversation("user-2", "shared-id")).toEqual([]);
  });

  it("keeps each user's copy of the same id separate", () => {
    appendExchange("user-1", "c1", "mine", "yours");
    appendExchange("user-2", "c1", "theirs", "ours");
    expect(loadConversation("user-1", "c1")[0]).toEqual({
      role: "user",
      content: "mine",
    });
    expect(loadConversation("user-2", "c1")[0]).toEqual({
      role: "user",
      content: "theirs",
    });
  });

  it("returns a copy, so a caller cannot mutate the stored history", () => {
    appendExchange("user-1", "c1", "hello", "hi");
    const history = loadConversation("user-1", "c1");
    history.push({ role: "user", content: "injected" });
    expect(loadConversation("user-1", "c1")).toHaveLength(2);
  });
});

describe("forgetting", () => {
  it("drops a conversation once it goes quiet", () => {
    // No read in between: any read would refresh the clock, which is the
    // keep-alive behaviour asserted in the next test.
    const t0 = 1_000_000;
    appendExchange("user-1", "c1", "hello", "hi", t0);
    expect(
      loadConversation("user-1", "c1", t0 + CONVERSATION_TTL_MS + 1),
    ).toEqual([]);
  });

  it("keeps a conversation alive while it is being used", () => {
    const t0 = 1_000_000;
    appendExchange("user-1", "c1", "hello", "hi", t0);
    // Read just before expiry: the clock restarts.
    loadConversation("user-1", "c1", t0 + CONVERSATION_TTL_MS - 1);
    expect(
      loadConversation("user-1", "c1", t0 + CONVERSATION_TTL_MS + 1),
    ).toHaveLength(2);
  });

  it("forgets on request", () => {
    appendExchange("user-1", "c1", "hello", "hi");
    forgetConversation("user-1", "c1");
    expect(loadConversation("user-1", "c1")).toEqual([]);
  });

  it("caps how much it keeps", () => {
    for (let i = 0; i < 60; i++) {
      appendExchange("user-1", "c1", `question ${i}`, `answer ${i}`);
    }
    const history = loadConversation("user-1", "c1");
    expect(history.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
    // The most recent turn survives; the oldest does not.
    expect(JSON.stringify(history)).toContain("question 59");
    expect(JSON.stringify(history)).not.toContain("question 0");
  });

  it("does not record an empty reply as a turn", () => {
    appendExchange("user-1", "c1", "hello", "");
    expect(loadConversation("user-1", "c1")).toEqual([
      { role: "user", content: "hello" },
    ]);
  });
});
