import {
  boolean,
  date,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { primaryId, softDelete, timestamps } from "./_shared";
import {
  consentMethodEnum,
  consentStatusEnum,
  consentTypeEnum,
  patientStatusEnum,
  preferredLanguageEnum,
} from "./enums";
import { organizations } from "./organizations";
import { employees, users } from "./users";

/**
 * patients — main demographic record (§8.3, FR-PAT-001).
 * marketing_opt_in is derived from active consents but cached here for fast
 * report filtering (§FR-PAT-005).
 */
export const patients = pgTable(
  "patients",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    patientNumber: varchar("patient_number", { length: 32 }).notNull(),
    legalFirstName: varchar("legal_first_name", { length: 120 }).notNull(),
    legalLastName: varchar("legal_last_name", { length: 120 }).notNull(),
    preferredName: varchar("preferred_name", { length: 120 }),
    pronouns: varchar("pronouns", { length: 40 }),
    dateOfBirth: date("date_of_birth"),
    // citext in the DB migration; email normalized on write.
    email: varchar("email", { length: 255 }),
    phoneE164: varchar("phone_e164", { length: 20 }),
    address: text("address"),
    preferredLanguage: preferredLanguageEnum("preferred_language")
      .notNull()
      .default("en"),
    status: patientStatusEnum("status").notNull().default("prospect"),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    emergencyContactName: varchar("emergency_contact_name", { length: 200 }),
    emergencyContactPhone: varchar("emergency_contact_phone", { length: 20 }),
    acquisitionSource: varchar("acquisition_source", { length: 120 }),
    primaryPractitionerId: uuid("primary_practitioner_id").references(
      () => employees.id,
    ),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    // §8.4 UNIQUE (organization_id, patient_number).
    unique("uq_patient_number").on(t.organizationId, t.patientNumber),
  ],
);

/**
 * patient_consents — versioned consents and withdrawals (§FR-PAT-004).
 * Marketing consent is a distinct type from care/communications (§FR-PAT-005).
 */
export const patientConsents = pgTable("patient_consents", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  consentType: consentTypeEnum("consent_type").notNull(),
  documentVersion: varchar("document_version", { length: 40 }).notNull(),
  method: consentMethodEnum("method").notNull(),
  status: consentStatusEnum("status").notNull().default("active"),
  scope: text("scope"),
  signedAt: timestamp("signed_at", { withTimezone: true, mode: "date" }),
  witnessName: varchar("witness_name", { length: 200 }),
  signatureStoragePath: text("signature_storage_path"),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true, mode: "date" }),
  recordedBy: uuid("recorded_by").references(() => users.id),
  ...timestamps,
});

/**
 * patient_alerts — critical clinical/administrative flags (§FR-PAT-006).
 */
export const patientAlerts = pgTable("patient_alerts", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  label: varchar("label", { length: 160 }).notNull(),
  severity: varchar("severity", { length: 20 }).notNull().default("info"),
  isClinical: boolean("is_clinical").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

/**
 * patient_tags — configurable administrative classification (§FR-PAT-006).
 */
export const patientTags = pgTable(
  "patient_tags",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    tag: varchar("tag", { length: 60 }).notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (t) => [unique("uq_patient_tag").on(t.patientId, t.tag)],
);
