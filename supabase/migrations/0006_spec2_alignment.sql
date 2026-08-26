CREATE TYPE "public"."billing_unit" AS ENUM('fixed', 'per_unit', 'per_hour', 'per_session');--> statement-breakpoint
CREATE TYPE "public"."care_incident_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."service_family" AS ENUM('clinic', 'coaching', 'home_care');--> statement-breakpoint
ALTER TYPE "public"."care_shift_status" ADD VALUE 'needs_review' BEFORE 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."care_shift_status" ADD VALUE 'missed';--> statement-breakpoint
CREATE TABLE "encounter_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"service_id" uuid,
	"description" varchar(300) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"line_total_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "care_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"shift_id" uuid,
	"patient_id" uuid NOT NULL,
	"caregiver_id" uuid,
	"severity" "care_incident_severity" NOT NULL,
	"description" text NOT NULL,
	"reported_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "family" "service_family" DEFAULT 'clinic' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "billing_unit" "billing_unit" DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "care_agreements" ADD COLUMN "default_tasks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "care_shifts" ADD COLUMN "tasks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "care_shifts" ADD COLUMN "approved_minutes" integer;--> statement-breakpoint
ALTER TABLE "care_shifts" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "care_shifts" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "encounter_lines" ADD CONSTRAINT "encounter_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_lines" ADD CONSTRAINT "encounter_lines_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_lines" ADD CONSTRAINT "encounter_lines_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_incidents" ADD CONSTRAINT "care_incidents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_incidents" ADD CONSTRAINT "care_incidents_shift_id_care_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."care_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_incidents" ADD CONSTRAINT "care_incidents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_incidents" ADD CONSTRAINT "care_incidents_caregiver_id_employees_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_incidents" ADD CONSTRAINT "care_incidents_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_shifts" ADD CONSTRAINT "care_shifts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Missed shifts don't block caregiver time either.
ALTER TABLE care_shifts DROP CONSTRAINT ex_care_shift_no_overlap;--> statement-breakpoint
ALTER TABLE care_shifts ADD CONSTRAINT ex_care_shift_no_overlap
  EXCLUDE USING gist (
    caregiver_id WITH =,
    tstzrange(start_at, end_at) WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show', 'missed'));--> statement-breakpoint
CREATE INDEX idx_encounter_lines_encounter ON encounter_lines (encounter_id);--> statement-breakpoint
CREATE INDEX idx_care_incidents_org_created ON care_incidents (organization_id, created_at);--> statement-breakpoint
-- RLS: encounter lines follow the encounters access model.
ALTER TABLE encounter_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE encounter_lines FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY encounter_lines_read ON encounter_lines FOR SELECT TO authenticated
  USING (
    organization_id = app.current_org()
    AND (
      app.has_any_role(ARRAY['owner','administrator','billing','auditor'])
      OR EXISTS (
        SELECT 1 FROM encounters e
        WHERE e.id = encounter_lines.encounter_id
          AND e.practitioner_id = app.current_employee_id()
      )
    )
  );--> statement-breakpoint
CREATE POLICY encounter_lines_write ON encounter_lines FOR ALL TO authenticated
  USING (
    organization_id = app.current_org()
    AND EXISTS (
      SELECT 1 FROM encounters e
      WHERE e.id = encounter_lines.encounter_id
        AND e.practitioner_id = app.current_employee_id()
        AND e.status = 'draft'
    )
  )
  WITH CHECK (organization_id = app.current_org());--> statement-breakpoint
-- RLS: incidents follow the care_shifts access model.
ALTER TABLE care_incidents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE care_incidents FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY care_incidents_read ON care_incidents FOR SELECT TO authenticated
  USING (
    organization_id = app.current_org()
    AND (
      app.has_any_role(ARRAY['owner','administrator','reception','auditor'])
      OR caregiver_id = app.current_employee_id()
    )
  );--> statement-breakpoint
CREATE POLICY care_incidents_write ON care_incidents FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = app.current_org()
    AND (
      app.has_any_role(ARRAY['owner','administrator','reception'])
      OR caregiver_id = app.current_employee_id()
    )
  );--> statement-breakpoint
CREATE POLICY care_incidents_admin_update ON care_incidents FOR UPDATE TO authenticated
  USING (
    organization_id = app.current_org()
    AND app.has_any_role(ARRAY['owner','administrator'])
  )
  WITH CHECK (organization_id = app.current_org());
