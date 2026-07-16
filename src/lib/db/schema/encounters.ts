import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import {
  appointmentModalityEnum,
  encounterStatusEnum,
} from "./enums";
import { appointments } from "./appointments";
import { organizations } from "./organizations";
import { patients } from "./patients";
import { services } from "./catalog";
import { employees, users } from "./users";

/**
 * encounter_templates + template_versions — dynamic per-service note templates
 * (§FR-ENC-002). A published version never changes existing encounters
 * retroactively.
 */
export const encounterTemplates = pgTable("encounter_templates", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: varchar("name", { length: 160 }).notNull(),
  serviceId: uuid("service_id").references(() => services.id),
  ...timestamps,
});

export const encounterTemplateVersions = pgTable("encounter_template_versions", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  templateId: uuid("template_id")
    .notNull()
    .references(() => encounterTemplates.id),
  version: integer("version").notNull().default(1),
  // Field schema: array of { key, label, type, options... }.
  schema: jsonb("schema").notNull().default([]),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
  publishedBy: uuid("published_by").references(() => users.id),
  ...timestamps,
});

/**
 * encounters — a consultation actually performed (§8.3, FR-ENC-001).
 * content_snapshot holds the structured template answers; summary is the
 * human-readable text. Once signed, the note becomes immutable.
 */
export const encounters = pgTable("encounters", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  appointmentId: uuid("appointment_id").references(() => appointments.id),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  practitionerId: uuid("practitioner_id")
    .notNull()
    .references(() => employees.id),
  serviceId: uuid("service_id").references(() => services.id),
  templateVersionId: uuid("template_version_id").references(
    () => encounterTemplateVersions.id,
  ),
  modality: appointmentModalityEnum("modality").notNull().default("in_person"),
  status: encounterStatusEnum("status").notNull().default("draft"),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
  endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
  contentSnapshot: jsonb("content_snapshot").notNull().default({}),
  summary: text("summary"),
  signedAt: timestamp("signed_at", { withTimezone: true, mode: "date" }),
  signedBy: uuid("signed_by").references(() => users.id),
  contentHash: varchar("content_hash", { length: 128 }),
  ...timestamps,
});

/**
 * encounter_amendments — corrections after signing (§FR-ENC-004).
 * The original note stays intact; amendments are appended chronologically.
 */
export const encounterAmendments = pgTable("encounter_amendments", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  encounterId: uuid("encounter_id")
    .notNull()
    .references(() => encounters.id),
  body: text("body").notNull(),
  authoredBy: uuid("authored_by")
    .notNull()
    .references(() => users.id),
  authoredAt: timestamp("authored_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  contentHash: varchar("content_hash", { length: 128 }),
});

/**
 * observations — measurements/results (§FR-ENC-005).
 * Value + unit are kept separate so trends never mix incompatible units.
 */
export const observations = pgTable("observations", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  encounterId: uuid("encounter_id").references(() => encounters.id),
  observationType: varchar("observation_type", { length: 80 }).notNull(),
  valueNumeric: integer("value_numeric"),
  valueText: text("value_text"),
  unit: varchar("unit", { length: 32 }),
  observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  source: varchar("source", { length: 60 }),
  comment: text("comment"),
  ...timestamps,
});
