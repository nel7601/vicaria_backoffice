import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";
import { accessLogs, auditEvents } from "@/lib/db/schema";

/**
 * Audit + access logging (spec §12.2, SEC-05).
 *
 * before/after payloads must be redacted of PHI by the caller; these helpers
 * only persist what they are given. Sensitive actions (void, refund, export,
 * sign, permission_change) require a `reason`.
 */

const SENSITIVE_ACTIONS = new Set([
  "void",
  "refund",
  "export",
  "sign",
  "delete",
  "permission_change",
]);

export interface AuditInput {
  organizationId?: string;
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  ip?: string;
  userAgent?: string;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  if (SENSITIVE_ACTIONS.has(input.action) && !input.reason) {
    throw new Error(`Audit action "${input.action}" requires a reason.`);
  }
  const db = getDb();
  await db.insert(auditEvents).values({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason,
    // Never store raw IPs — hash for privacy minimization (§12.2).
    ipHash: input.ip ? hashIp(input.ip) : undefined,
    userAgent: input.userAgent?.slice(0, 255),
  });
}

export interface AccessInput {
  organizationId?: string;
  actorUserId?: string;
  patientId?: string;
  action: string;
  route?: string;
  purpose?: string;
}

/** Log access to a patient record for privacy audits (§12.2). */
export async function recordAccess(input: AccessInput): Promise<void> {
  const db = getDb();
  await db.insert(accessLogs).values({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    patientId: input.patientId,
    action: input.action,
    route: input.route,
    purpose: input.purpose,
  });
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}
