import fs from "fs";
import path from "path";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });

const connectionString =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test";

async function migrate() {
  const pool = new pg.Pool({ connectionString });
  const drizzleDir = path.join(process.cwd(), "drizzle");
  const sqlFiles = fs
    .readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = await pool.connect();
  try {
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
    console.log("Migrations applied cleanly.");
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});

