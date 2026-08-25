import {
  boolean,
  date,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { careAgreementStatusEnum, careShiftStatusEnum } from "./enums";
import { organizations } from "./organizations";
import { employees, users } from "./users";
import { patients } from "./patients";

/**
 * Home-care (Vicaria Care) domain — senior in-home care service.
 *
 * Model (industry-standard home-care flow):
 *   care_agreements — the contract with the family: weekly hours, period,
 *     hourly rate. One client (patient) can have several agreements over time.
 *   care_contacts — family members / substitute decision-makers for a client.
 *   care_shifts — scheduled visits under an agreement, assigned to a
 *     caregiver (employee with is_caregiver), with check-in/out (EVV-style)
 *     and visit notes.
 */

export const careContacts = pgTable("care_contacts", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  name: varchar("name", { length: 200 }).notNull(),
  relationship: varchar("relationship", { length: 80 }),
  phone: varchar("phone", { length: 32 }),
  email: varchar("email", { length: 255 }),
  /** Primary family contact for scheduling and approvals. */
  isPrimary: boolean("is_primary").notNull().default(false),
  /** May approve schedule/agreement changes on behalf of the client. */
  canApprove: boolean("can_approve").notNull().default(false),
  notes: text("notes"),
  ...timestamps,
});

export const careAgreements = pgTable("care_agreements", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  status: careAgreementStatusEnum("status").notNull().default("draft"),
  /** Contracted care time per week, in minutes (e.g. 20h/week = 1200). */
  weeklyMinutes: integer("weekly_minutes").notNull(),
  startDate: date("start_date").notNull(),
  /** Null = open-ended until explicitly ended. */
  endDate: date("end_date"),
  hourlyRateCents: integer("hourly_rate_cents").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("CAD"),
  /** Care plan summary: routines, mobility, medication reminders, etc. */
  carePlan: text("care_plan"),
  address: text("address"),
  ...timestamps,
});

export const careShifts = pgTable("care_shifts", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  agreementId: uuid("agreement_id")
    .notNull()
    .references(() => careAgreements.id),
  /** Denormalized for fast per-client queries; matches the agreement's. */
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  caregiverId: uuid("caregiver_id")
    .notNull()
    .references(() => employees.id),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  status: careShiftStatusEnum("status").notNull().default("scheduled"),
  /** EVV-style actuals recorded by check-in/check-out. */
  checkInAt: timestamp("check_in_at", { withTimezone: true }),
  checkOutAt: timestamp("check_out_at", { withTimezone: true }),
  /** Visit note written at/after check-out. */
  visitNotes: text("visit_notes"),
  cancellationReason: text("cancellation_reason"),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
});
