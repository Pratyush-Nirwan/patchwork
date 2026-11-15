ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_active_at" timestamp with time zone NOT NULL DEFAULT now();
UPDATE "sessions" SET "last_active_at" = "created_at";

