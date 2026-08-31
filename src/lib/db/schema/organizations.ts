import {
  boolean,
  integer,
  jsonb,
  text,
  time,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { pgTable } from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { calendarFeedDetailEnum } from "./enums";

/**
 * organizations — tenant boundary (§8.2, §9.3).
 * MVP runs for a single org, but every business table carries organization_id
 * so RLS and future multi-tenant isolation work without a redesign.
 */
export const organizations = pgTable("organizations", {
  id: primaryId(),
  legalName: varchar("legal_name", { length: 200 }).notNull(),
  operatingName: varchar("operating_name", { length: 200 }),
  timezone: varchar("timezone", { length: 64 }).notNull().default("America/Toronto"),
  currency: varchar("currency", { length: 3 }).notNull().default("CAD"),
  ...timestamps,
});

/**
 * company_settings — identity, numbering, taxes and legal texts (§8.2, FR-ADM-001).
 */
export const companySettings = pgTable("company_settings", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  address: text("address"),
  phone: varchar("phone", { length: 32 }),
  email: varchar("email", { length: 255 }),
  website: varchar("website", { length: 255 }),
  logoStoragePath: text("logo_storage_path"),
  // Invoice numbering configuration (§FR-INV-002).
  invoiceNumberPrefix: varchar("invoice_number_prefix", { length: 16 }).default("INV-"),
  invoiceNextSequence: integer("invoice_next_sequence").notNull().default(1),
  // Tax config, e.g. { "HST": { rate_bps: 1300 } }. Rates in basis points.
  taxConfig: jsonb("tax_config").notNull().default({}),
  legalFooterEn: text("legal_footer_en"),
  legalFooterEs: text("legal_footer_es"),
  /**
   * How much a personal-calendar event may say about the patient. These events
   * are stored by Google/Apple/Zoho, outside our control, so the default keeps
   * the name out of them and links back here for the rest.
   */
  calendarFeedDetail: calendarFeedDetailEnum("calendar_feed_detail")
    .notNull()
    .default("initials"),
  ...timestamps,
});

/**
 * locations — branches, hours and local config (§8.2, FR-ADM-001).
 */
export const locations = pgTable("locations", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: varchar("name", { length: 120 }).notNull(),
  address: text("address"),
  phone: varchar("phone", { length: 32 }),
  timezone: varchar("timezone", { length: 64 }).notNull().default("America/Toronto"),
  isActive: boolean("is_active").notNull().default(true),
  openTime: time("open_time"),
  closeTime: time("close_time"),
  ...timestamps,
});
