import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import {
  communicationChannelEnum,
  communicationDirectionEnum,
  documentAccessLevelEnum,
} from "./enums";
import { organizations } from "./organizations";
import { patients } from "./patients";
import { users } from "./users";

/**
 * documents — metadata for private files (§FR-DOC-001/002).
 * storage_path points to a private bucket; it is never a permanent public URL.
 * Files are served through short-lived signed URLs (SEC-04).
 */
export const documents = pgTable("documents", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  patientId: uuid("patient_id").references(() => patients.id),
  category: varchar("category", { length: 60 }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 120 }),
  sizeBytes: integer("size_bytes"),
  sha256: varchar("sha256", { length: 64 }),
  storagePath: text("storage_path").notNull(),
  accessLevel: documentAccessLevelEnum("access_level")
    .notNull()
    .default("administrative"),
  // Skin before/after photos require consent (§FR-SKIN-003).
  requiresConsent: boolean("requires_consent").notNull().default(false),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  ...timestamps,
});

/**
 * communications — contact history (§FR-COM-001).
 */
export const communications = pgTable("communications", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  channel: communicationChannelEnum("channel").notNull(),
  direction: communicationDirectionEnum("direction").notNull().default("outbound"),
  subject: varchar("subject", { length: 200 }),
  outcome: text("outcome"),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  recordedBy: uuid("recorded_by").references(() => users.id),
  ...timestamps,
});
