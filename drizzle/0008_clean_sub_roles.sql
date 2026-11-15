UPDATE "team_members"
SET "sub_role" = 'developer'
WHERE "sub_role" NOT IN ('developer', 'tester') OR "sub_role" IS NULL;
--> statement-breakpoint
ALTER TABLE "team_members" ALTER COLUMN "sub_role" SET DEFAULT 'developer';

