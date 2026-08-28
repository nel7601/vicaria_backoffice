import type { AiMessage } from "./provider/types";

/**
 * Short-lived conversation memory.
 *
 * Without it every turn starts from nothing and the user has to speak like a
 * search box: "appointments for Friday", "appointments for Saturday". With it
 * they can say "and next week?" — which is the whole difference between a
 * command line with a microphone and something worth talking to.
 *
 * Deliberately in memory and deliberately short-lived. The plan rules out
 * persisted transcripts in the MVP: a conversation about patients is PHI, and
 * storing it means answering retention, access and deletion questions that
 * have not been answered yet. This forgets on its own.
 *
 * KNOWN LIMIT: process memory is not shared between serverless instances, so a
 * conversation whose next turn lands elsewhere starts fresh. On Vercel that is
 * a real possibility, and the fix is the same durable store the rate limiter
 * already needs. Until then the failure is graceful — the agent asks the user
 * to repeat the context rather than inventing it.
 */

export interface Conversation {
  id: string;
  messages: AiMessage[];
  lastUsedAt: number;
}

/** Long enough to finish a thought, short enough not to linger. */
export const CONVERSATION_TTL_MS = 20 * 60_000;

/** Turns kept in context. Older ones fall off the front. */
export const MAX_HISTORY_MESSAGES = 40;

const conversations = new Map<string, Conversation>();

function key(userId: string, conversationId: string): string {
  return `${userId}:${conversationId}`;
}

function sweep(now: number): void {
  for (const [k, c] of conversations) {
    if (now - c.lastUsedAt > CONVERSATION_TTL_MS) conversations.delete(k);
  }
}

/**
 * Fetch a conversation's history, or an empty one.
 *
 * Scoped by user as well as id: a conversation id is not a capability, and one
 * user handing another an id must not hand over the conversation.
 */
export function loadConversation(
  userId: string,
  conversationId: string,
  now: number = Date.now(),
): AiMessage[] {
  sweep(now);
  const found = conversations.get(key(userId, conversationId));
  if (!found) return [];
  found.lastUsedAt = now;
  return [...found.messages];
}

/**
 * Record a completed exchange.
 *
 * Only the user's words and the agent's reply are kept — not the tool calls or
 * their results. Those are re-fetched each turn, so keeping them would grow
 * context without bound and, worse, let a stale answer be reused as if it were
 * current. The clinic's data changes; last turn's copy of it is not evidence.
 */
export function appendExchange(
  userId: string,
  conversationId: string,
  input: string,
  reply: string,
  now: number = Date.now(),
): void {
  const k = key(userId, conversationId);
  const existing = conversations.get(k);
  const messages: AiMessage[] = existing ? existing.messages : [];

  messages.push({ role: "user", content: input });
  if (reply) messages.push({ role: "assistant", content: reply });

  conversations.set(k, {
    id: conversationId,
    messages: messages.slice(-MAX_HISTORY_MESSAGES),
    lastUsedAt: now,
  });
}

/** Drop a conversation, e.g. when the user starts over or signs out. */
export function forgetConversation(userId: string, conversationId: string): void {
  conversations.delete(key(userId, conversationId));
}

/** Testing seam. */
export function resetConversations(): void {
  conversations.clear();
}
