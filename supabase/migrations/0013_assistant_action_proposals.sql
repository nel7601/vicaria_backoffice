CREATE TABLE "assistant_action_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"tool_name" varchar(80) NOT NULL,
	"arguments_json" jsonb NOT NULL,
	"arguments_hash" varchar(64) NOT NULL,
	"summary" varchar(1000) NOT NULL,
	"status" varchar(20) DEFAULT 'proposed' NOT NULL,
	"conversation_id" uuid,
	"request_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"failure_reason" varchar(300)
);
--> statement-breakpoint
ALTER TABLE "assistant_action_proposals" ADD CONSTRAINT "assistant_action_proposals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_action_proposals" ADD CONSTRAINT "assistant_action_proposals_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_proposals_actor_status" ON "assistant_action_proposals" USING btree ("actor_user_id","status");--> statement-breakpoint
CREATE INDEX "ix_proposals_expiry" ON "assistant_action_proposals" USING btree ("expires_at");
--> statement-breakpoint

-- RLS (§9.3). A proposal is a pending write against this tenant's data, so it
-- is scoped like everything else — and further: only the person who must
-- confirm it can see it at all. Another user in the same organization has no
-- business reading, let alone consuming, someone else's pending action.
ALTER TABLE assistant_action_proposals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY assistant_proposals_select ON assistant_action_proposals
FOR SELECT TO authenticated
USING (
  organization_id = app.current_org()
  AND actor_user_id IN (SELECT id FROM users WHERE auth_user_id = auth.uid())
);
--> statement-breakpoint
-- Proposals are created and consumed by trusted server code holding the
-- principal, never written directly from a client session.
CREATE POLICY assistant_proposals_no_client_write ON assistant_action_proposals
FOR INSERT TO authenticated WITH CHECK (false);
