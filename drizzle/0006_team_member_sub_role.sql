ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "sub_role" text DEFAULT 'developer';
--> statement-breakpoint
UPDATE "team_members" SET "sub_role" = 'developer' WHERE "sub_role" IS NULL AND "role" = 'member';

