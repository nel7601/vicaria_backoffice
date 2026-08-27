import {
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import {
  bodySideEnum,
  followUpTaskStatusEnum,
  goalStatusEnum,
  skinLesionComplexityEnum,
  taskPriorityEnum,
  treatmentPlanStatusEnum,
} from "./enums";
import { encounters } from "./encounters";
import { organizations } from "./organizations";
import { patients } from "./patients";
import { employees, users } from "./users";

/**
 * treatment_plans + goals — coaching/treatment planning (§FR-PLAN-001/002).
 */
export const treatmentPlans = pgTable("treatment_plans", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  title: varchar("title", { length: 200 }).notNull(),
  objective: text("objective"),
  status: treatmentPlanStatusEnum("status").notNull().default("draft"),
  responsibleId: uuid("responsible_id").references(() => employees.id),
  startDate: timestamp("start_date", { withTimezone: true, mode: "date" }),
  endDate: timestamp("end_date", { withTimezone: true, mode: "date" }),
  ...timestamps,
});

export const treatmentGoals = pgTable("treatment_goals", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  planId: uuid("plan_id")
    .notNull()
    .references(() => treatmentPlans.id),
  description: text("description").notNull(),
  baseline: varchar("baseline", { length: 120 }),
  target: varchar("target", { length: 120 }),
  status: goalStatusEnum("status").notNull().default("not_started"),
  targetDate: timestamp("target_date", { withTimezone: true, mode: "date" }),
  lastProgressAt: timestamp("last_progress_at", { withTimezone: true, mode: "date" }),
  ...timestamps,
});

/**
 * patient_chart_notes — free-text notes a clinician adds to the clinical
 * record outside an encounter (e.g. a follow-up phone call). They appear
 * chronologically in the record's Evolution tab.
 */
export const patientChartNotes = pgTable("patient_chart_notes", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  authorUserId: uuid("author_user_id").references(() => users.id),
  notedAt: timestamp("noted_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  body: text("body").notNull(),
  ...timestamps,
});

/**
 * follow_up_tasks — pending actions per patient (§FR-FU-001).
 * Overdue tasks surface on the dashboard and the CLN-01 report.
 */
export const followUpTasks = pgTable("follow_up_tasks", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  title: varchar("title", { length: 200 }).notNull(),
  taskType: varchar("task_type", { length: 60 }),
  assignedTo: uuid("assigned_to").references(() => employees.id),
  dueDate: timestamp("due_date", { withTimezone: true, mode: "date" }),
  priority: taskPriorityEnum("priority").notNull().default("normal"),
  status: followUpTaskStatusEnum("status").notNull().default("open"),
  ...timestamps,
});

/**
 * skin_procedures + skin_lesions — skin treatment records (§FR-SKIN-001/002).
 * Lesions are the billable units; suggested totals come from pricing rules.
 */
export const skinProcedures = pgTable("skin_procedures", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  encounterId: uuid("encounter_id").references(() => encounters.id),
  practitionerId: uuid("practitioner_id")
    .notNull()
    .references(() => employees.id),
  procedureType: varchar("procedure_type", { length: 120 }).notNull(),
  bodyArea: varchar("body_area", { length: 120 }),
  technique: varchar("technique", { length: 120 }),
  performedAt: timestamp("performed_at", { withTimezone: true, mode: "date" }),
  result: text("result"),
  aftercareInstructions: text("aftercare_instructions"),
  ...timestamps,
});

export const skinLesions = pgTable("skin_lesions", {
  id: primaryId(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  procedureId: uuid("procedure_id")
    .notNull()
    .references(() => skinProcedures.id),
  lesionType: varchar("lesion_type", { length: 120 }).notNull(),
  sizeMm: integer("size_mm"),
  quantity: integer("quantity").notNull().default(1),
  location: varchar("location", { length: 120 }),
  side: bodySideEnum("side").notNull().default("n_a"),
  complexity: skinLesionComplexityEnum("complexity").notNull().default("simple"),
  unitPriceCents: integer("unit_price_cents").notNull().default(0),
  notes: text("notes"),
  ...timestamps,
});
