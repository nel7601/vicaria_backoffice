-- Clinical record: free-text chart notes a clinician adds outside an
-- encounter (e.g. a follow-up phone call). Shown in the Evolution tab.
CREATE TABLE "patient_chart_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"author_user_id" uuid,
	"noted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patient_chart_notes" ADD CONSTRAINT "patient_chart_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_chart_notes" ADD CONSTRAINT "patient_chart_notes_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_chart_notes" ADD CONSTRAINT "patient_chart_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX idx_patient_chart_notes_patient ON patient_chart_notes (organization_id, patient_id, noted_at DESC);--> statement-breakpoint
-- RLS: chart notes follow the clinical-notes access model.
ALTER TABLE patient_chart_notes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE patient_chart_notes FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY patient_chart_notes_read ON patient_chart_notes FOR SELECT TO authenticated
  USING (
    organization_id = app.current_org()
    AND app.has_any_role(ARRAY['owner','administrator','practitioner','auditor'])
  );--> statement-breakpoint
CREATE POLICY patient_chart_notes_write ON patient_chart_notes FOR ALL TO authenticated
  USING (
    organization_id = app.current_org()
    AND app.has_any_role(ARRAY['owner','administrator','practitioner'])
  )
  WITH CHECK (organization_id = app.current_org());
