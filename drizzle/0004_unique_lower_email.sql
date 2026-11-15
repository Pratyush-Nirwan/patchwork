DO $$
DECLARE
    r RECORD;
    local_part TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
        FOR r IN
            SELECT id, email, row_number() OVER (PARTITION BY lower(email) ORDER BY created_at ASC, id ASC) as rn
            FROM users
        LOOP
            IF r.rn > 1 THEN
                local_part := regexp_replace(split_part(r.email, '@', 1), '[^a-zA-Z0-9._-]', '', 'g');
                IF local_part = '' THEN
                    local_part := 'user';
                END IF;
                UPDATE users SET email = lower(local_part) || '+duplicate-' || r.id || '@invalid.local' WHERE id = r.id;
            END IF;
        END LOOP;
    END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_lower_email_idx" ON "users" (lower("email"));

