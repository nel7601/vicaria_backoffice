import {
  bigserial,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * audit_events — tamper-evident trail (§8.3, §12.2, SEC-05).
 * Append-only: never updated or deleted. before/after are redacted of PHI.
 * `reason` is required for sensitive actions (void, refund, export, sign).
 */
export const auditEvents = pgTable("audit_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  action: varchar("action", { length: 60 }).notNull(),
  entityType: varchar("entity_type", { length: 80 }).notNull(),
  entityId: varchar("entity_id", { length: 80 }),
  before: jsonb("before"),
  after: jsonb("after"),
  reason: text("reason"),
  ipHash: varchar("ip_hash", { length: 64 }),
  userAgent: varchar("user_agent", { length: 255 }),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * access_logs — patient-record access trail for privacy audits (§12.2).
 */
export const accessLogs = pgTable("access_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  patientId: uuid("patient_id"),
  action: varchar("action", { length: 60 }).notNull(),
  route: varchar("route", { length: 200 }),
  purpose: varchar("purpose", { length: 120 }),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * privacy_requests — access/correction/export/erasure requests (§12.3).
 */
export const privacyRequests = pgTable("privacy_requests", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  patientId: uuid("patient_id"),
  requestType: varchar("request_type", { length: 40 }).notNull(),
  status: varchar("status", { length: 40 }).notNull().default("open"),
  assignedTo: uuid("assigned_to").references(() => users.id),
  dueDate: timestamp("due_date", { withTimezone: true, mode: "date" }),
  resolution: text("resolution"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});
