-- Acquisition sources as a controlled list (spec §14 "Client Source").
--
-- patients.acquisition_source was free text, so MKT-01 counted "Google",
-- "google" and "Google Ads" as three different channels and the report could
-- not answer "where do our patients come from". The column stays text (issued
-- history is never rewritten); Settings now feeds it from this list.
CREATE TABLE "acquisition_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"name_es" varchar(120),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_acquisition_source" UNIQUE("organization_id","name")
);--> statement-breakpoint
ALTER TABLE "acquisition_sources" ADD CONSTRAINT "acquisition_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Starting list, plus every value already recorded on a patient so no existing
-- record points at a source that is not in the menu.
DO $$
DECLARE
  org uuid;
  s text;
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    FOREACH s IN ARRAY ARRAY[
      'Google', 'Website', 'WhatsApp', 'Instagram', 'Facebook',
      'Referral', 'Walk-in', 'Event', 'Other'
    ] LOOP
      INSERT INTO acquisition_sources (organization_id, name)
      VALUES (org, s)
      ON CONFLICT ON CONSTRAINT uq_acquisition_source DO NOTHING;
    END LOOP;

    INSERT INTO acquisition_sources (organization_id, name)
    SELECT DISTINCT org, btrim(p.acquisition_source)
      FROM patients p
     WHERE p.organization_id = org
       AND p.acquisition_source IS NOT NULL
       AND btrim(p.acquisition_source) <> ''
       AND length(btrim(p.acquisition_source)) <= 120
    ON CONFLICT ON CONSTRAINT uq_acquisition_source DO NOTHING;
  END LOOP;
END $$;
