import {
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import {
  appointmentModalityEnum,
  appointmentStatusEnum,
} from "./enums";
import { locations, organizations } from "./organizations";
import { patients } from "./patients";
import { employees, users } from "./users";
import { services } from "./catalog";

/**
 * appointments — schedule and states (§8.3, FR-APT-*).
 * estimated_price_cents is frozen at creation; rescheduled_from_id links a
 * rescheduled appointment back to its original (§FR-APT-005).
 */
export const appointments = pgTable("appointments", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  serviceId: uuid("service_id").references(() => services.id),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id),
  locationId: uuid("location_id").references(() => locations.id),
  startAt: timestamp("start_at", { withTimezone: true, mode: "date" }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true, mode: "date" }).notNull(),
  modality: appointmentModalityEnum("modality").notNull().default("in_person"),
  status: appointmentStatusEnum("status").notNull().default("scheduled"),
  estimatedPriceCents: integer("estimated_price_cents").notNull().default(0),
  cancellationReason: text("cancellation_reason"),
  rescheduledFromId: uuid("rescheduled_from_id"),
  notesAdmin: text("notes_admin"),
  ...timestamps,
});

/**
 * appointment_status_history — immutable audit of state changes (§8.2, FR-APT-004).
 * Never updated; one row per transition with actor and reason.
 */
export const appointmentStatusHistory = pgTable("appointment_status_history", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  appointmentId: uuid("appointment_id")
    .notNull()
    .references(() => appointments.id),
  fromStatus: appointmentStatusEnum("from_status"),
  toStatus: appointmentStatusEnum("to_status").notNull(),
  reason: text("reason"),
  changedBy: uuid("changed_by").references(() => users.id),
  changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export type AppointmentStatus = (typeof appointmentStatusEnum.enumValues)[number];
