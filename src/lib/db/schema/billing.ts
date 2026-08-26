import { sql } from "drizzle-orm";
import {
  char,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import {
  cashSessionStatusEnum,
  invoiceStatusEnum,
  paymentMethodEnum,
  paymentStatusEnum,
  preferredLanguageEnum,
} from "./enums";
import { locations, organizations } from "./organizations";
import { patients } from "./patients";
import { users } from "./users";

/**
 * invoices — financial document (§8.3, FR-INV-*).
 * invoice_number is null until issued (§FR-INV-002); status is derived from
 * allocations, never edited freely (§FR-INV-003). snapshot freezes printed data.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    invoiceNumber: varchar("invoice_number", { length: 40 }),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    /** General description/notes shown on the invoice (spec §11). */
    notes: text("notes"),
    issueDate: timestamp("issue_date", { withTimezone: true, mode: "date" }),
    dueDate: timestamp("due_date", { withTimezone: true, mode: "date" }),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    discountCents: integer("discount_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    paidCents: integer("paid_cents").notNull().default(0),
    balanceCents: integer("balance_cents").notNull().default(0),
    currency: char("currency", { length: 3 }).notNull().default("CAD"),
    language: preferredLanguageEnum("language").notNull().default("en"),
    snapshot: jsonb("snapshot").notNull().default({}),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }),
    voidedAt: timestamp("voided_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (t) => [
    // §8.4 partial UNIQUE for issued invoices only.
    uniqueIndex("uq_invoice_number")
      .on(t.organizationId, t.invoiceNumber)
      .where(sql`${t.invoiceNumber} IS NOT NULL`),
    // §8.4 CHECK total_cents >= 0.
    check("ck_invoice_total_nonneg", sql`${t.totalCents} >= 0`),
  ],
);

/**
 * invoice_items — lines frozen at issue (§FR-INV-001).
 */
export const invoiceItems = pgTable("invoice_items", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPriceCents: integer("unit_price_cents").notNull(),
  discountCents: integer("discount_cents").notNull().default(0),
  taxRateBps: integer("tax_rate_bps").notNull().default(0),
  lineTotalCents: integer("line_total_cents").notNull(),
  serviceId: uuid("service_id"),
  ...timestamps,
});

/**
 * payments — collections ledger (§8.3, FR-PAY-*).
 * external_provider/external_id give idempotency for Square (§8.4 unique).
 */
export const payments = pgTable(
  "payments",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    method: paymentMethodEnum("method").notNull(),
    status: paymentStatusEnum("status").notNull().default("pending"),
    amountCents: integer("amount_cents").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("CAD"),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    receivedBy: uuid("received_by").references(() => users.id),
    externalProvider: varchar("external_provider", { length: 40 }),
    externalId: varchar("external_id", { length: 120 }),
    reference: varchar("reference", { length: 120 }),
    // E-transfer verification fields (§FR-PAY-003).
    etransferSenderName: varchar("etransfer_sender_name", { length: 200 }),
    etransferSenderEmail: varchar("etransfer_sender_email", { length: 255 }),
    verifiedBy: uuid("verified_by").references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
    cashSessionId: uuid("cash_session_id"),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps,
  },
  (t) => [
    // §8.4 UNIQUE (external_provider, external_id) for Square/webhook idempotency.
    uniqueIndex("uq_payment_external")
      .on(t.externalProvider, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    // §8.4 CHECK amount_cents > 0.
    check("ck_payment_amount_pos", sql`${t.amountCents} > 0`),
  ],
);

/**
 * payment_allocations — applies a payment to an invoice (§FR-PAY-002).
 * The sum of allocations may never exceed the payment amount or invoice balance
 * (enforced transactionally + verified in domain tests).
 */
export const paymentAllocations = pgTable("payment_allocations", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => payments.id),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id),
  amountCents: integer("amount_cents").notNull(),
  ...timestamps,
});

/**
 * refunds — linked to the original payment (§FR-REF-001).
 */
export const refunds = pgTable("refunds", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => payments.id),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason"),
  externalProvider: varchar("external_provider", { length: 40 }),
  externalId: varchar("external_id", { length: 120 }),
  processedBy: uuid("processed_by").references(() => users.id),
  processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  ...timestamps,
});

/**
 * credit_notes — linked to an invoice (§FR-REF-001).
 */
export const creditNotes = pgTable("credit_notes", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason"),
  issuedBy: uuid("issued_by").references(() => users.id),
  ...timestamps,
});

/**
 * receipts — snapshots of receipts issued for confirmed payments (§FR-REC-001).
 */
export const receipts = pgTable("receipts", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  // Nullable: an invoice-level receipt aggregates its confirmed payments; a
  // per-payment receipt sets this. (§FR-REC-001)
  paymentId: uuid("payment_id").references(() => payments.id),
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  receiptNumber: varchar("receipt_number", { length: 40 }),
  amountCents: integer("amount_cents").notNull(),
  language: preferredLanguageEnum("language").notNull().default("en"),
  snapshot: jsonb("snapshot").notNull().default({}),
  issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  ...timestamps,
});

/**
 * cash_sessions + cash_movements — cash drawer control (§FR-PAY-004).
 */
export const cashSessions = pgTable("cash_sessions", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  locationId: uuid("location_id").references(() => locations.id),
  status: cashSessionStatusEnum("status").notNull().default("open"),
  openingFloatCents: integer("opening_float_cents").notNull().default(0),
  expectedCents: integer("expected_cents"),
  countedCents: integer("counted_cents"),
  differenceCents: integer("difference_cents"),
  openedBy: uuid("opened_by").references(() => users.id),
  openedAt: timestamp("opened_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  closedBy: uuid("closed_by").references(() => users.id),
  closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
  ...timestamps,
});

export const cashMovements = pgTable("cash_movements", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  cashSessionId: uuid("cash_session_id")
    .notNull()
    .references(() => cashSessions.id),
  amountCents: integer("amount_cents").notNull(),
  kind: varchar("kind", { length: 40 }).notNull(),
  paymentId: uuid("payment_id").references(() => payments.id),
  note: text("note"),
  ...timestamps,
});
