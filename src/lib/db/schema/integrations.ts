import {
  boolean,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { organizations } from "./organizations";
import { payments } from "./billing";

/**
 * webhook_events — idempotent inbox for external webhooks (§10.1, NFR-11).
 * event_id is unique so a repeated Square delivery is stored once and never
 * creates a duplicate payment.
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: primaryId(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    provider: varchar("provider", { length: 40 }).notNull(),
    eventId: varchar("event_id", { length: 160 }).notNull(),
    eventType: varchar("event_type", { length: 120 }),
    payload: jsonb("payload").notNull().default({}),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("uq_webhook_event").on(t.provider, t.eventId)],
);

/**
 * square_transactions — mapped Square objects (§10.1).
 * Idempotent upsert keyed by (provider, square_payment_id). Reconciliation
 * flags transactions with no matched patient/invoice or an amount mismatch.
 */
export const squareTransactions = pgTable(
  "square_transactions",
  {
    id: primaryId(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    squarePaymentId: varchar("square_payment_id", { length: 120 }).notNull(),
    squareOrderId: varchar("square_order_id", { length: 120 }),
    squareCustomerId: varchar("square_customer_id", { length: 120 }),
    status: varchar("status", { length: 40 }),
    amountCents: integer("amount_cents"),
    tender: varchar("tender", { length: 40 }),
    paymentId: uuid("payment_id").references(() => payments.id),
    reconciled: boolean("reconciled").notNull().default(false),
    raw: jsonb("raw").notNull().default({}),
    ...timestamps,
  },
  (t) => [unique("uq_square_payment").on(t.squarePaymentId)],
);
