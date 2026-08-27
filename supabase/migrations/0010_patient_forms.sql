-- Standalone form responses: forms are now filled from the clinical record
-- (not inside the encounter note). Each row is one filled form for a patient,
-- keeping the template version so later schema changes never mutate history.
CREATE TABLE "patient_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"template_version_id" uuid NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"filled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"filled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patient_forms" ADD CONSTRAINT "patient_forms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_forms" ADD CONSTRAINT "patient_forms_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_forms" ADD CONSTRAINT "patient_forms_template_version_id_encounter_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."encounter_template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_forms" ADD CONSTRAINT "patient_forms_filled_by_users_id_fk" FOREIGN KEY ("filled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX idx_patient_forms_patient ON patient_forms (organization_id, patient_id, filled_at DESC);--> statement-breakpoint
-- RLS: form responses follow the clinical-notes access model.
ALTER TABLE patient_forms ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE patient_forms FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY patient_forms_read ON patient_forms FOR SELECT TO authenticated
  USING (
    organization_id = app.current_org()
    AND app.has_any_role(ARRAY['owner','administrator','practitioner','auditor'])
  );--> statement-breakpoint
CREATE POLICY patient_forms_write ON patient_forms FOR ALL TO authenticated
  USING (
    organization_id = app.current_org()
    AND app.has_any_role(ARRAY['owner','administrator','practitioner'])
  )
  WITH CHECK (organization_id = app.current_org());
