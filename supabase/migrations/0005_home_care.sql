CREATE TYPE "public"."care_agreement_status" AS ENUM('draft', 'active', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."care_shift_status" AS ENUM('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TABLE "care_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"status" "care_agreement_status" DEFAULT 'draft' NOT NULL,
	"weekly_minutes" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"hourly_rate_cents" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'CAD' NOT NULL,
	"care_plan" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "care_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"relationship" varchar(80),
	"phone" varchar(32),
	"email" varchar(255),
	"is_primary" boolean DEFAULT false NOT NULL,
	"can_approve" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "care_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"caregiver_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" "care_shift_status" DEFAULT 'scheduled' NOT NULL,
	"check_in_at" timestamp with time zone,
	"check_out_at" timestamp with time zone,
	"visit_notes" text,
	"cancellation_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "is_caregiver" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "care_agreements" ADD CONSTRAINT "care_agreements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_agreements" ADD CONSTRAINT "care_agreements_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_contacts" ADD CONSTRAINT "care_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_contacts" ADD CONSTRAINT "care_contacts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_shifts" ADD CONSTRAINT "care_shifts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_shifts" ADD CONSTRAINT "care_shifts_agreement_id_care_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."care_agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_shifts" ADD CONSTRAINT "care_shifts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_shifts" ADD CONSTRAINT "care_shifts_caregiver_id_employees_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_shifts" ADD CONSTRAINT "care_shifts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Indexes & integrity
-- ---------------------------------------------------------------------------
CREATE INDEX idx_care_agreements_org_patient ON care_agreements (organization_id, patient_id);--> statement-breakpoint
CREATE INDEX idx_care_contacts_org_patient ON care_contacts (organization_id, patient_id);--> statement-breakpoint
CREATE INDEX idx_care_shifts_org_start ON care_shifts (organization_id, start_at);--> statement-breakpoint
CREATE INDEX idx_care_shifts_agreement ON care_shifts (agreement_id, start_at);--> statement-breakpoint
CREATE INDEX idx_care_shifts_caregiver ON care_shifts (caregiver_id, start_at);--> statement-breakpoint
ALTER TABLE care_shifts ADD CONSTRAINT ck_care_shift_times CHECK (end_at > start_at);--> statement-breakpoint
-- A caregiver cannot hold two overlapping active shifts (btree_gist from 0001).
ALTER TABLE care_shifts ADD CONSTRAINT ex_care_shift_no_overlap
  EXCLUDE USING gist (
    caregiver_id WITH =,
    tstzrange(start_at, end_at) WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show'));--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- RLS (mirrors §4.2 matrix for the home_care resource)
-- ---------------------------------------------------------------------------
ALTER TABLE care_agreements ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE care_agreements FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE care_contacts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE care_contacts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE care_shifts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE care_shifts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY care_agreements_read ON care_agreements FOR SELECT TO authenticated
  USING (
    organization_id = app.current_org()
    AND (
      app.has_any_role(ARRAY['owner','administrator','reception','billing','auditor'])
      OR EXISTS (
        SELECT 1 FROM care_shifts s
        WHERE s.agreement_id = care_agreements.id
          AND s.caregiver_id = app.current_employee_id()
      )
    )
  );--> statement-breakpoint
CREATE POLICY care_agreements_write ON care_agreements FOR ALL TO authenticated
  USING (
    organization_id = app.current_org()
    AND app.has_any_role(ARRAY['owner','administrator','reception'])
  )
  WITH CHECK (
    organization_id = app.current_org()
    AND app.has_any_role(ARRAY['owner','administrator','reception'])
  );--> statement-breakpoint
CREATE POLICY care_contacts_read ON care_contacts FOR SELECT TO authenticated
  USING (
    organization_id = app.current_org()
    AND (
      app.has_any_role(ARRAY['owner','administrator','reception','billing','auditor'])
      OR EXISTS (
        SELECT 1 FROM care_shifts s
        WHERE s.patient_id = care_contacts.patient_id
          AND s.caregiver_id = app.current_employee_id()
      )
    )
  );--> statement-breakpoint
CREATE POLICY care_contacts_write ON care_contacts FOR ALL TO authenticated
  USING (
    organization_id = app.current_org()
    AND app.has_any_role(ARRAY['owner','administrator','reception'])
  )
  WITH CHECK (
    organization_id = app.current_org()
    AND app.has_any_role(ARRAY['owner','administrator','reception'])
  );--> statement-breakpoint
CREATE POLICY care_shifts_read ON care_shifts FOR SELECT TO authenticated
  USING (
    organization_id = app.current_org()
    AND (
      app.has_any_role(ARRAY['owner','administrator','reception','billing','auditor'])
      OR caregiver_id = app.current_employee_id()
    )
  );--> statement-breakpoint
CREATE POLICY care_shifts_write ON care_shifts FOR ALL TO authenticated
  USING (
    organization_id = app.current_org()
    AND app.has_any_role(ARRAY['owner','administrator','reception'])
  )
  WITH CHECK (
    organization_id = app.current_org()
    AND app.has_any_role(ARRAY['owner','administrator','reception'])
  );--> statement-breakpoint
-- Caregivers may update their own shifts (check-in/out, notes) but not move
-- them: times, assignment and linkage stay unchanged.
CREATE POLICY care_shifts_own_update ON care_shifts FOR UPDATE TO authenticated
  USING (
    organization_id = app.current_org()
    AND caregiver_id = app.current_employee_id()
  )
  WITH CHECK (
    organization_id = app.current_org()
    AND caregiver_id = app.current_employee_id()
  );
