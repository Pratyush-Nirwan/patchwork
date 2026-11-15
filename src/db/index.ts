import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import fs from "fs";
import path from "path";
import { deduplicateExistingEmails } from "@/lib/deduplicate-emails";

const connectionString =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test";

const globalForDb = globalThis as unknown as {
  pgPool?: Pool;
  migrated?: boolean;
};

export const pool =
  globalForDb.pgPool ??
  new Pool({
    connectionString,
    max: 15,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pgPool = pool;
}

export const db = drizzle(pool, { schema });

export async function ensureMigrated(): Promise<void> {
  if (globalForDb.migrated) return;
  const drizzleDir = path.join(process.cwd(), "drizzle");
  if (!fs.existsSync(drizzleDir)) return;
  const sqlFiles = fs
    .readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(84729104)");
    await deduplicateExistingEmails(client);
    for (const file of sqlFiles) {
      const raw = fs.readFileSync(path.join(drizzleDir, file), "utf8");
      const statements = raw
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) {
        await client.query(stmt);
      }
    }
    globalForDb.migrated = true;
  } finally {
    await client.query("SELECT pg_advisory_unlock(84729104)").catch(() => undefined);
    client.release();
  }
}

