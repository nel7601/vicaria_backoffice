import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import {
  appointmentModalityEnum,
  billingUnitEnum,
  packageEnrollmentStatusEnum,
  serviceFamilyEnum,
} from "./enums";
import { organizations } from "./organizations";
import { patients } from "./patients";
import { users } from "./users";

/**
 * service_categories — controlled category list for services (filters and
 * reports work on a consistent vocabulary instead of free text).
 */
export const serviceCategories = pgTable(
  "service_categories",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: varchar("name", { length: 80 }).notNull(),
    nameEs: varchar("name_es", { length: 80 }),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [unique("uq_service_category").on(t.organizationId, t.name)],
);

/**
 * services — bilingual service catalog (§FR-SVC-001).
 * Prices are versioned separately so editing a price never rewrites history.
 */
export const services = pgTable("services", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  nameEn: varchar("name_en", { length: 160 }).notNull(),
  nameEs: varchar("name_es", { length: 160 }).notNull(),
  category: varchar("category", { length: 80 }),
  /** Service family (spec §3): drives documentation and billing behaviour. */
  family: serviceFamilyEnum("family").notNull().default("clinic"),
  /** How the service is charged (spec §3): fixed, per unit/lesion, hour, session. */
  billingUnit: billingUnitEnum("billing_unit").notNull().default("fixed"),
  defaultDurationMinutes: integer("default_duration_minutes").notNull().default(60),
  modality: appointmentModalityEnum("modality").notNull().default("in_person"),
  accountingCode: varchar("accounting_code", { length: 40 }),
  taxCode: varchar("tax_code", { length: 40 }),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

/**
 * service_prices — versioned price list (§FR-SVC-001).
 * Invoices snapshot the price at issue, so changes here never mutate issued docs.
 */
export const servicePrices = pgTable("service_prices", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  serviceId: uuid("service_id")
    .notNull()
    .references(() => services.id),
  priceCents: integer("price_cents").notNull(),
  taxRateBps: integer("tax_rate_bps").notNull().default(0),
  effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  effectiveTo: timestamp("effective_to", { withTimezone: true, mode: "date" }),
  ...timestamps,
});

/**
 * packages — prepaid session products (§FR-PKG-001).
 */
export const packages = pgTable("packages", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  nameEn: varchar("name_en", { length: 160 }).notNull(),
  nameEs: varchar("name_es", { length: 160 }).notNull(),
  priceCents: integer("price_cents").notNull(),
  totalSessions: integer("total_sessions").notNull(),
  version: integer("version").notNull().default(1),
  validityDays: integer("validity_days"),
  transferable: boolean("transferable").notNull().default(false),
  refundable: boolean("refundable").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

/**
 * package_enrollments — a patient's purchase of a package (§FR-PKG-002).
 * sessionsRemaining must always equal totalSessions - sessions consumed in
 * package_session_usage (verified in domain tests).
 */
export const packageEnrollments = pgTable("package_enrollments", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  packageId: uuid("package_id")
    .notNull()
    .references(() => packages.id),
  invoiceId: uuid("invoice_id"),
  status: packageEnrollmentStatusEnum("status").notNull().default("active"),
  totalSessions: integer("total_sessions").notNull(),
  sessionsUsed: integer("sessions_used").notNull().default(0),
  purchasedAt: timestamp("purchased_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  ...timestamps,
});

/**
 * package_session_usage — append-only ledger of session consumption (§FR-PKG-003).
 * A reversal is recorded as a separate row with a positive delta and a reason.
 */
export const packageSessionUsage = pgTable("package_session_usage", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  enrollmentId: uuid("enrollment_id")
    .notNull()
    .references(() => packageEnrollments.id),
  encounterId: uuid("encounter_id"),
  // -1 for consumption, +1 for an authorized reversal.
  delta: integer("delta").notNull(),
  reason: text("reason"),
  recordedBy: uuid("recorded_by").references(() => users.id),
  ...timestamps,
});
