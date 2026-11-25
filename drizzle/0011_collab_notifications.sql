CREATE TABLE IF NOT EXISTS "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text DEFAULT 'ticket' NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"actor_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"idempotency_key" text NOT NULL UNIQUE,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"dead_lettered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "domain_events_pending_idx" ON "domain_events" ("next_attempt_at", "created_at") WHERE "processed_at" IS NULL AND "dead_lettered_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "domain_events_aggregate_idx" ON "domain_events" ("aggregate_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ticket_watchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL REFERENCES "tickets"("id") ON DELETE cascade,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"source" text DEFAULT 'manual' NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"unwatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_watchers_ticket_user_uidx" ON "ticket_watchers" ("ticket_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_watchers_user_idx" ON "ticket_watchers" ("user_id", "muted");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"in_app_mentions" boolean DEFAULT true NOT NULL,
	"in_app_assignments" boolean DEFAULT true NOT NULL,
	"in_app_watched" boolean DEFAULT true NOT NULL,
	"email_mentions" text DEFAULT 'immediate' NOT NULL,
	"email_assignments" text DEFAULT 'immediate' NOT NULL,
	"email_watched" text DEFAULT 'off' NOT NULL,
	"digest_frequency" text DEFAULT 'daily' NOT NULL,
	"digest_hour" integer DEFAULT 9 NOT NULL,
	"digest_day" integer DEFAULT 1 NOT NULL,
	"auto_watch_creator" boolean DEFAULT true NOT NULL,
	"auto_watch_assignee" boolean DEFAULT true NOT NULL,
	"auto_watch_commenter" boolean DEFAULT true NOT NULL,
	"auto_watch_mentioned" boolean DEFAULT true NOT NULL,
	"presence_enabled" boolean DEFAULT true NOT NULL,
	"last_digest_sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"type" text NOT NULL,
	"ticket_id" uuid NOT NULL REFERENCES "tickets"("id") ON DELETE cascade,
	"comment_id" uuid REFERENCES "ticket_comments"("id") ON DELETE set null,
	"actor_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL UNIQUE,
	"group_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_recipient_list_idx" ON "notifications" ("recipient_id", "archived_at", "read_at", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_recipient_unread_idx" ON "notifications" ("recipient_id", "created_at" DESC) WHERE "read_at" IS NULL AND "archived_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_recipient_group_idx" ON "notifications" ("recipient_id", "group_key", "created_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"category" text NOT NULL,
	"ticket_id" uuid REFERENCES "tickets"("id") ON DELETE set null,
	"notification_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL UNIQUE,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_outbox_pending_idx" ON "email_outbox" ("status", "next_attempt_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_outbox_recipient_idx" ON "email_outbox" ("recipient_id", "created_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"format" text DEFAULT 'generic' NOT NULL,
	"events" text[] DEFAULT '{}'::text[] NOT NULL,
	"scope_team_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"scope_project_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"scope_board_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"secret_iv" text NOT NULL,
	"secret_auth_tag" text NOT NULL,
	"secret_key_version" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"disabled_reason" text,
	"disabled_at" timestamp with time zone,
	"created_by_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_endpoints_org_idx" ON "webhook_endpoints" ("org_id", "enabled");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL REFERENCES "webhook_endpoints"("id") ON DELETE cascade,
	"domain_event_id" uuid REFERENCES "domain_events"("id") ON DELETE set null,
	"event_type" text NOT NULL,
	"idempotency_key" text NOT NULL UNIQUE,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response_status" integer,
	"duration_ms" integer,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_pending_idx" ON "webhook_deliveries" ("status", "next_attempt_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" ("endpoint_id", "created_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "worker_health" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"worker_id" text NOT NULL,
	"mode" text DEFAULT 'embedded' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_events" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
