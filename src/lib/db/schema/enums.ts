import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Controlled enums for the Vicaria backoffice.
 *
 * Spec §8.1: "Estados como enums controlados o tablas de referencia, nunca
 * texto libre." Appendix A lists the recommended state machines.
 */

export const preferredLanguageEnum = pgEnum("preferred_language", ["en", "es"]);

export const patientStatusEnum = pgEnum("patient_status", [
  "prospect",
  "active",
  "inactive",
  "blocked",
  "deceased",
]);

export const roleEnum = pgEnum("role", [
  "owner",
  "administrator",
  "practitioner",
  "reception",
  "billing",
  "marketing",
  "auditor",
]);

export const appointmentModalityEnum = pgEnum("appointment_modality", [
  "in_person",
  "virtual",
  "phone",
]);

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "scheduled",
  "confirmed",
  "checked_in",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
]);

export const encounterStatusEnum = pgEnum("encounter_status", [
  "draft",
  "signed",
  "amended",
  "entered_in_error",
]);

export const treatmentPlanStatusEnum = pgEnum("treatment_plan_status", [
  "draft",
  "active",
  "paused",
  "completed",
  "cancelled",
]);

export const goalStatusEnum = pgEnum("goal_status", [
  "not_started",
  "in_progress",
  "achieved",
  "missed",
  "cancelled",
]);

export const followUpTaskStatusEnum = pgEnum("follow_up_task_status", [
  "open",
  "in_progress",
  "completed",
  "cancelled",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "overdue",
  "void",
  "refunded",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "confirmed",
  "failed",
  "cancelled",
  "partially_refunded",
  "refunded",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "e_transfer",
  "square_card",
  "square_invoice",
  "debit",
  "credit",
  "other",
]);

export const packageEnrollmentStatusEnum = pgEnum("package_enrollment_status", [
  "active",
  "exhausted",
  "expired",
  "paused",
  "transferred",
  "cancelled",
]);

export const consentTypeEnum = pgEnum("consent_type", [
  "care",
  "privacy",
  "communications",
  "marketing",
  "procedure",
  "photography",
]);

export const consentMethodEnum = pgEnum("consent_method", [
  "written",
  "verbal",
  "electronic",
]);

export const consentStatusEnum = pgEnum("consent_status", [
  "active",
  "withdrawn",
  "expired",
]);

export const documentAccessLevelEnum = pgEnum("document_access_level", [
  "administrative",
  "clinical",
  "financial",
  "restricted",
]);

export const communicationChannelEnum = pgEnum("communication_channel", [
  "email",
  "phone",
  "whatsapp",
  "in_person",
  "note",
]);

export const communicationDirectionEnum = pgEnum("communication_direction", [
  "inbound",
  "outbound",
]);

export const cashSessionStatusEnum = pgEnum("cash_session_status", [
  "open",
  "closed",
]);

export const skinLesionComplexityEnum = pgEnum("skin_lesion_complexity", [
  "simple",
  "moderate",
  "complex",
]);

export const bodySideEnum = pgEnum("body_side", ["left", "right", "central", "n_a"]);

export const careAgreementStatusEnum = pgEnum("care_agreement_status", [
  "draft",
  "active",
  "paused",
  "ended",
]);

export const careShiftStatusEnum = pgEnum("care_shift_status", [
  "scheduled",
  "confirmed",
  "in_progress",
  "completed",
  "needs_review",
  "cancelled",
  "no_show",
  "missed",
]);

export const serviceFamilyEnum = pgEnum("service_family", [
  "clinic",
  "coaching",
  "home_care",
]);

export const billingUnitEnum = pgEnum("billing_unit", [
  "fixed",
  "per_unit",
  "per_hour",
  "per_session",
]);

export const careIncidentSeverityEnum = pgEnum("care_incident_severity", [
  "low",
  "medium",
  "high",
  "critical",
]);

/**
 * How much a personal-calendar feed may say about the patient (§ calendar
 * sync). These events leave our servers, so the choice is deliberate:
 *   minimal   "Consultation — 30 min"
 *   initials  "Consultation — A.R."   (default)
 *   full      "Consultation — Ana Ruiz"
 */
export const calendarFeedDetailEnum = pgEnum("calendar_feed_detail", [
  "minimal",
  "initials",
  "full",
]);

/**
 * Where a form template belongs (task: Thermocoagulation forms).
 *   clinical        part of the clinical record — tabs and Evolution
 *   administrative  attached to the patient's file, never to the chart
 *                   (e.g. a release of liability, an authorization)
 */
export const templateScopeEnum = pgEnum("template_scope", [
  "clinical",
  "administrative",
]);
