ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_setup_admin" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN IF NOT EXISTS "description" text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "setup_state" (
  "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
  "admin_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "org_id" uuid REFERENCES "orgs"("id") ON DELETE SET NULL,
  "current_step" integer NOT NULL DEFAULT 1,
  "completed_steps" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "skipped_steps" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "draft_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_completed" boolean NOT NULL DEFAULT false,
  "completed_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

