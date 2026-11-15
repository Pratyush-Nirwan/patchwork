ALTER TABLE "columns" ALTER COLUMN "position" TYPE double precision;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "setup_credentials" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "ciphertext" text NOT NULL,
  "iv" text NOT NULL,
  "auth_tag" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

