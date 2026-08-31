-- Personal calendar sync: a secret, revocable iCalendar feed per employee.
--
-- The URL is the credential, so it is long, per-employee, revocable, and never
-- shown to anyone but the owner and an administrator. What the feed says about
-- a patient is an organization-wide setting (calendar_feed_detail), because
-- these events end up stored on Google/Apple/Zoho servers, outside our control.
CREATE TYPE "calendar_feed_detail" AS ENUM ('minimal', 'initials', 'full');
--> statement-breakpoint
ALTER TABLE company_settings
  ADD COLUMN calendar_feed_detail "calendar_feed_detail" NOT NULL DEFAULT 'initials';
--> statement-breakpoint
CREATE TABLE "calendar_feed_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_feed_tokens" ADD CONSTRAINT "calendar_feed_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feed_tokens" ADD CONSTRAINT "calendar_feed_tokens_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feed_tokens" ADD CONSTRAINT "calendar_feed_tokens_token_unique" UNIQUE ("token");--> statement-breakpoint
-- One live token per employee; revoking sets revoked_at, rotating inserts a new row.
CREATE UNIQUE INDEX idx_calendar_feed_one_live
  ON calendar_feed_tokens (employee_id) WHERE revoked_at IS NULL;--> statement-breakpoint
-- RLS: an employee may see their own token; owners/administrators see all.
-- The feed endpoint itself reads with the service role, since the subscriber
-- is a calendar client with no session — the token is the authorization.
ALTER TABLE calendar_feed_tokens ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE calendar_feed_tokens FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY calendar_feed_tokens_read ON calendar_feed_tokens FOR SELECT TO authenticated
  USING (
    organization_id = app.current_org()
    AND (
      app.has_any_role(ARRAY['owner','administrator'])
      OR employee_id = app.current_employee_id()
    )
  );--> statement-breakpoint
CREATE POLICY calendar_feed_tokens_write ON calendar_feed_tokens FOR ALL TO authenticated
  USING (
    organization_id = app.current_org()
    AND (
      app.has_any_role(ARRAY['owner','administrator'])
      OR employee_id = app.current_employee_id()
    )
  )
  WITH CHECK (organization_id = app.current_org());
