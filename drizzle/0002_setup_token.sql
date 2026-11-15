CREATE TABLE IF NOT EXISTS "setup_token" (
  "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
  "ciphertext" text,
  "iv" text,
  "auth_tag" text,
  "key_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "confirmed_at" timestamp with time zone,
  "consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "setup_token" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;
