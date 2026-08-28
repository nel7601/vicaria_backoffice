import {
  index,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { primaryId } from "./_shared";
import { organizations, users } from "./index-refs";

/**
 * assistant_action_proposals — a write the assistant proposed and a person has
 * not yet confirmed (§6.2 of the assistant plan).
 *
 * The single-use guarantee lives here rather than in a signed token. A token
 * can prove who issued it but not that it has already been spent, and two
 * serverless instances handling a retried confirmation would each accept the
 * same one. A conditional UPDATE on `status` cannot: exactly one of them wins.
 *
 * Arguments are stored as the server resolved them, so what executes is what
 * the user was shown — not what the model reconstructs on a later turn.
 */
export const assistantActionProposals = pgTable(
  "assistant_action_proposals",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    /** The user who must confirm. Nobody else can consume this proposal. */
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    toolName: varchar("tool_name", { length: 80 }).notNull(),
    /** Canonical, server-resolved arguments. */
    argumentsJson: jsonb("arguments_json").notNull(),
    /** Hash of the arguments, to detect a mismatch on execution. */
    argumentsHash: varchar("arguments_hash", { length: 64 }).notNull(),
    /** What the user was shown, so audit can say what they agreed to. */
    summary: varchar("summary", { length: 1000 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("proposed"),
    conversationId: uuid("conversation_id"),
    requestId: varchar("request_id", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /** Short TTL: a stale proposal describes a world that has moved on. */
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    failureReason: varchar("failure_reason", { length: 300 }),
  },
  (t) => [
    index("ix_proposals_actor_status").on(t.actorUserId, t.status),
    index("ix_proposals_expiry").on(t.expiresAt),
  ],
);

export type ProposalStatus =
  | "proposed"
  | "consumed"
  | "cancelled"
  | "expired"
  | "failed";
