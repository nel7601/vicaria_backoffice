import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assistantActionProposals } from "@/lib/db/schema";
import type { Principal } from "@/lib/auth/principal";

/**
 * Action proposals: the gap between "the agent understood" and "the clinic's
 * data changed" (§6.2 of the assistant plan).
 *
 * Nothing the model asks for is executed when it asks. The server resolves the
 * arguments, writes them down, and shows the user exactly what will happen.
 * Only a separate, explicit confirmation consumes the row and performs the
 * write.
 *
 * The row is what makes single-use real. A signed token proves who issued it
 * but not that it has already been spent, so two retried confirmations hitting
 * two serverless instances would both pass. A conditional UPDATE cannot be
 * satisfied twice.
 */

/** Short enough that the world it describes has not moved on (§6.2). */
export const PROPOSAL_TTL_MS = 3 * 60_000;

export interface ProposalInput {
  toolName: string;
  /** Canonical, server-resolved arguments — never the model's raw text. */
  arguments: Record<string, unknown>;
  /** Exactly what the user is shown and asked to confirm. */
  summary: string;
  conversationId?: string;
  requestId?: string;
}

export interface StoredProposal {
  proposalId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  summary: string;
  expiresAt: Date;
}

/**
 * Canonical hash of the arguments.
 *
 * Keys are sorted so that the same arguments always hash alike regardless of
 * property order. It exists to detect a mismatch between what was shown and
 * what is about to run — the confirmation is only meaningful if those are the
 * same thing.
 */
export function hashArguments(args: Record<string, unknown>): string {
  return createHash("sha256").update(canonical(args)).digest("hex");
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export async function createProposal(
  principal: Principal & { organizationId: string; dbUserId: string },
  input: ProposalInput,
  now: Date = new Date(),
): Promise<StoredProposal> {
  const db = getDb();
  const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_MS);

  const [row] = await db
    .insert(assistantActionProposals)
    .values({
      organizationId: principal.organizationId,
      actorUserId: principal.dbUserId,
      toolName: input.toolName,
      argumentsJson: input.arguments,
      argumentsHash: hashArguments(input.arguments),
      summary: input.summary.slice(0, 1000),
      status: "proposed",
      conversationId: input.conversationId ?? null,
      requestId: input.requestId ?? null,
      createdAt: now,
      expiresAt,
    })
    .returning();

  return {
    proposalId: row.id,
    toolName: row.toolName,
    arguments: row.argumentsJson as Record<string, unknown>,
    summary: row.summary,
    expiresAt: row.expiresAt,
  };
}

export type ClaimFailure =
  | "not_found"
  | "already_used"
  | "expired"
  | "cancelled";

export type ClaimResult =
  | { ok: true; proposal: StoredProposal }
  | { ok: false; reason: ClaimFailure };

/**
 * Atomically claim a proposal for execution.
 *
 * The conditional UPDATE is the whole mechanism: status must still be
 * `proposed`, it must belong to this user and tenant, and it must not have
 * expired. Two simultaneous confirmations both run this statement and exactly
 * one gets a row back.
 *
 * The second one is then told why it failed, which requires reading the row
 * again — a read that only happens on the losing path, so the winning path
 * stays a single statement.
 */
export async function claimProposal(
  principal: Principal & { organizationId: string; dbUserId: string },
  proposalId: string,
  now: Date = new Date(),
): Promise<ClaimResult> {
  const db = getDb();

  const claimed = await db
    .update(assistantActionProposals)
    .set({ status: "consumed", consumedAt: now })
    .where(
      and(
        eq(assistantActionProposals.id, proposalId),
        eq(assistantActionProposals.organizationId, principal.organizationId),
        eq(assistantActionProposals.actorUserId, principal.dbUserId),
        eq(assistantActionProposals.status, "proposed"),
        // gt() rather than a raw sql template: the template hands the Date
        // straight to the driver, which cannot serialise it.
        gt(assistantActionProposals.expiresAt, now),
      ),
    )
    .returning();

  if (claimed.length === 1) {
    const row = claimed[0];
    return {
      ok: true,
      proposal: {
        proposalId: row.id,
        toolName: row.toolName,
        arguments: row.argumentsJson as Record<string, unknown>,
        summary: row.summary,
        expiresAt: row.expiresAt,
      },
    };
  }

  return { ok: false, reason: await explainFailure(principal, proposalId, now) };
}

/**
 * Why a claim failed, without telling the caller anything about proposals that
 * are not theirs: another user's id is reported as "not found", the same as an
 * id that never existed.
 */
async function explainFailure(
  principal: Principal & { organizationId: string; dbUserId: string },
  proposalId: string,
  now: Date,
): Promise<ClaimFailure> {
  const db = getDb();
  const [row] = await db
    .select({
      status: assistantActionProposals.status,
      expiresAt: assistantActionProposals.expiresAt,
    })
    .from(assistantActionProposals)
    .where(
      and(
        eq(assistantActionProposals.id, proposalId),
        eq(assistantActionProposals.organizationId, principal.organizationId),
        eq(assistantActionProposals.actorUserId, principal.dbUserId),
      ),
    )
    .limit(1);

  if (!row) return "not_found";
  if (row.status === "cancelled") return "cancelled";
  if (row.status !== "proposed") return "already_used";
  return row.expiresAt <= now ? "expired" : "already_used";
}

/** Withdraw a pending proposal. Idempotent from the caller's point of view. */
export async function cancelProposal(
  principal: Principal & { organizationId: string; dbUserId: string },
  proposalId: string,
): Promise<{ ok: boolean; reason?: ClaimFailure }> {
  const db = getDb();
  const cancelled = await db
    .update(assistantActionProposals)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(assistantActionProposals.id, proposalId),
        eq(assistantActionProposals.organizationId, principal.organizationId),
        eq(assistantActionProposals.actorUserId, principal.dbUserId),
        eq(assistantActionProposals.status, "proposed"),
      ),
    )
    .returning({ id: assistantActionProposals.id });

  if (cancelled.length === 1) return { ok: true };
  return { ok: false, reason: await explainFailure(principal, proposalId, new Date()) };
}

/** Record that a claimed proposal could not be carried out. */
export async function markProposalFailed(
  proposalId: string,
  reason: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(assistantActionProposals)
    .set({ status: "failed", failureReason: reason.slice(0, 300) })
    .where(eq(assistantActionProposals.id, proposalId));
}
