import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { AiMessage } from "./provider/types";

/**
 * Conversation memory, carried by the client and readable only by the server.
 *
 * Without memory every turn starts from nothing and the user has to speak like
 * a search box. The obvious fix — keep the history in a Map — works on one
 * machine and fails on Vercel, where the next turn may land on a different
 * instance. That failure is worse than having no memory at all: the assistant
 * would forget at random and look unreliable rather than stateless.
 *
 * The alternative to a shared store is to stop storing it. The server encrypts
 * the history and hands it back as an opaque string; the client returns it
 * with the next turn. No store to share, no instance to stick to, and nothing
 * persisted anywhere — which also satisfies the plan's rule against persisted
 * transcripts, since a conversation about patients is PHI.
 *
 * The client cannot read it (AES-256-GCM) and cannot alter it (the tag is
 * checked, with the user id as associated data, so one user's sealed history
 * will not open for another).
 */

/** Long enough to finish a thought, short enough not to linger. */
export const CONVERSATION_TTL_MS = 20 * 60_000;

/** Turns carried forward. Older ones fall off the front. */
export const MAX_HISTORY_MESSAGES = 20;

/** Refuse to open anything absurd rather than allocating for it. */
const MAX_SEALED_BYTES = 128 * 1024;

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class ConversationKeyMissing extends Error {
  constructor() {
    super("ASSISTANT_CONVERSATION_KEY is not configured");
    this.name = "ConversationKeyMissing";
  }
}

/**
 * The sealing key.
 *
 * Deliberately its own secret rather than derived from another: reusing the
 * database or Supabase key here would mean rotating one forces the other.
 * Rotating this key only costs in-flight conversations, which restart.
 */
function sealingKey(): Buffer {
  const configured = process.env.ASSISTANT_CONVERSATION_KEY;
  if (!configured) throw new ConversationKeyMissing();
  // Accept any length and normalise: a hex key, a base64 key, or a passphrase
  // all become 32 bytes, so nobody has to generate one in a specific format.
  return createHash("sha256").update(configured).digest();
}

/** True when conversations can be carried at all. */
export function conversationMemoryAvailable(): boolean {
  return Boolean(process.env.ASSISTANT_CONVERSATION_KEY);
}

interface Envelope {
  /** Epoch ms after which this is refused. */
  exp: number;
  messages: AiMessage[];
}

/**
 * Seal a history for this user.
 *
 * Returns an opaque string to hand to the client. The user id is authenticated
 * but not encrypted — it is bound as associated data, so a blob sealed for one
 * user fails to open for another instead of leaking across accounts.
 */
export function sealConversation(
  userId: string,
  messages: AiMessage[],
  now: number = Date.now(),
): string {
  const kept = messages.slice(-MAX_HISTORY_MESSAGES);
  const envelope: Envelope = { exp: now + CONVERSATION_TTL_MS, messages: kept };

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, sealingKey(), iv);
  cipher.setAAD(Buffer.from(userId, "utf8"));

  const body = Buffer.concat([
    cipher.update(JSON.stringify(envelope), "utf8"),
    cipher.final(),
  ]);

  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/**
 * Open a sealed history, or return nothing.
 *
 * Every failure — tampered, expired, sealed for someone else, sealed with a
 * key that has since rotated — returns an empty history rather than throwing.
 * Losing the thread degrades to asking the user to repeat themselves; throwing
 * would fail a turn that could otherwise be answered.
 */
export function openConversation(
  userId: string,
  sealed: string | undefined,
  now: number = Date.now(),
): AiMessage[] {
  if (!sealed || sealed.length > MAX_SEALED_BYTES) return [];

  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length <= IV_BYTES + TAG_BYTES) return [];

    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const body = raw.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, sealingKey(), iv);
    decipher.setAAD(Buffer.from(userId, "utf8"));
    decipher.setAuthTag(tag);

    const json = Buffer.concat([
      decipher.update(body),
      decipher.final(),
    ]).toString("utf8");

    const envelope = JSON.parse(json) as Envelope;
    if (typeof envelope.exp !== "number" || envelope.exp <= now) return [];
    if (!Array.isArray(envelope.messages)) return [];

    return envelope.messages.slice(-MAX_HISTORY_MESSAGES);
  } catch {
    return [];
  }
}

/**
 * Add one exchange and reseal.
 *
 * Only what was said is carried — not the tool calls or their results. Those
 * are re-fetched each turn, so keeping them would grow the blob without bound
 * and let a stale copy of the schedule be reused as if it were current.
 */
export function extendConversation(
  userId: string,
  sealed: string | undefined,
  input: string,
  reply: string,
  now: number = Date.now(),
): string {
  const history = openConversation(userId, sealed, now);
  history.push({ role: "user", content: input });
  if (reply) history.push({ role: "assistant", content: reply });
  return sealConversation(userId, history, now);
}
