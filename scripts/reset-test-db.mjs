import fs from "fs";
import path from "path";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.test" });

const testDbUrl =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test";

const parsed = new URL(testDbUrl);
const dbName = parsed.pathname.replace(/^\//, "") || "patchwork_test";
const adminUrl = new URL(testDbUrl);
adminUrl.pathname = "/postgres";

async function resetTestDb() {
  const adminPool = new pg.Pool({ connectionString: adminUrl.toString() });
  const adminClient = await adminPool.connect();
  try {
    await adminClient.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName]
    );
    await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await adminClient.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    adminClient.release();
    await adminPool.end();
  }

  const testPool = new pg.Pool({ connectionString: testDbUrl });
  const testClient = await testPool.connect();
  try {
    const drizzleDir = path.join(process.cwd(), "drizzle");
    const sqlFiles = fs
      .readdirSync(drizzleDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of sqlFiles) {
      const raw = fs.readFileSync(path.join(drizzleDir, file), "utf8");
      const statements = raw
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);

      for (const stmt of statements) {
        await testClient.query(stmt);
      }
    }
    console.log(`Database ${dbName} reset and migrated.`);
  } finally {
    testClient.release();
    await testPool.end();
  }
}

resetTestDb().catch((err) => {
  console.error("Failed to reset test DB:", err);
  process.exit(1);
});

