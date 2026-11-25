import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import pg from "pg";
import { findPostgresTools, getSystemInfo } from "../lib/platform.mjs";

export const EXPECTED_TABLES = [
  "users",
  "sessions",
  "orgs",
  "org_members",
  "teams",
  "team_members",
  "projects",
  "boards",
  "columns",
  "tickets",
  "ticket_comments",
  "ticket_activities",
  "ticket_attachments",
  "ticket_links",
  "setup_state",
  "setup_token",
  "setup_credentials",
  "system_settings",
  "domain_events",
  "ticket_watchers",
  "user_notification_preferences",
  "notifications",
  "email_outbox",
  "webhook_endpoints",
  "webhook_deliveries",
  "worker_health",
];

function quoteIdent(ident) {
  return `"${String(ident).replace(/"/g, '""')}"`;
}

function escapeLiteral(val) {
  return `'${String(val).replace(/'/g, "''")}'`;
}

export function buildDatabaseUrl({ host, port, dbName, dbUser, dbPassword }) {
  const encodedUser = encodeURIComponent(dbUser);
  const encodedPass = encodeURIComponent(dbPassword);
  const encodedDb = encodeURIComponent(dbName);
  return `postgres://${encodedUser}:${encodedPass}@${host}:${port}/${encodedDb}`;
}

export async function canConnectDatabase(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 2500,
  });
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      return { ok: true };
    } finally {
      client.release();
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await pool.end().catch(() => {});
  }
}

export function detectPostgresAuthGuidance(err) {
  const msg = err instanceof Error ? err.message : String(err || "");
  const sys = getSystemInfo();
  const pgTools = findPostgresTools();
  const isAuthOrHba =
    /28P01|28000|password authentication failed|pg_hba\.conf|no pg_hba\.conf entry/i.test(
      msg
    );
  if (!isAuthOrHba) return "";

  if (sys.isLinux) {
    return [
      "PostgreSQL authentication / pg_hba.conf error.",
      "On Ubuntu/Debian, local TCP connections may require scram-sha-256 or md5 in /etc/postgresql/<ver>/main/pg_hba.conf,",
      "or peer auth via `sudo -u postgres psql -c \"ALTER USER postgres WITH PASSWORD '<password>';\"`.",
      pgTools.psql ? `Detected psql at: ${pgTools.psql}` : "Install postgresql-client if psql is missing.",
    ].join(" ");
  }

  return [
    "PostgreSQL authentication / pg_hba.conf error.",
    "Verify the postgres password set during the Windows PostgreSQL installer and check pg_hba.conf.",
    pgTools.psql
      ? `Detected psql at: ${pgTools.psql}`
      : "Add PostgreSQL bin directory (e.g. Program Files\\PostgreSQL\\17\\bin) to PATH.",
  ].join(" ");
}

function runLinuxPeerPsql(sql, { psqlBin = "psql", isRoot = false } = {}) {
  const args = ["-v", "ON_ERROR_STOP=1", "-d", "postgres", "-c", sql];
  if (isRoot) {
    return execFileSync(psqlBin, args, {
      encoding: "utf8",
      stdio: "pipe",
      shell: false,
    });
  }
  return execFileSync("sudo", ["-u", "postgres", psqlBin, ...args], {
    encoding: "utf8",
    stdio: "pipe",
    shell: false,
  });
}

export async function provisionDatabase({
  superuserUrl = "postgres://postgres:postgres@localhost:5432/postgres",
  host = "localhost",
  port = 5432,
  dbName = "patchwork",
  dbUser = "patchwork",
  dbPassword,
  createTestDb = false,
  testDbName = "patchwork_test",
  allowPeerSudo = false,
  confirmPeerSudo,
}) {
  const appDatabaseUrl = buildDatabaseUrl({
    host,
    port,
    dbName,
    dbUser,
    dbPassword,
  });

  // First check if app user and database already exist and connect directly
  const directCheck = await canConnectDatabase(appDatabaseUrl);

  const adminPool = new pg.Pool({
    connectionString: superuserUrl,
    connectionTimeoutMillis: 4000,
  });
  let adminClient;
  try {
    adminClient = await adminPool.connect();
  } catch (err) {
    const sys = getSystemInfo();
    const pgTools = findPostgresTools();
    if (
      sys.isLinux &&
      pgTools.psql &&
      /28P01|28000|password authentication failed|peer/i.test(
        err instanceof Error ? err.message : String(err)
      )
    ) {
      const approved =
        sys.isRoot ||
        allowPeerSudo ||
        (typeof confirmPeerSudo === "function" && (await confirmPeerSudo()));
      if (approved) {
        const superUser = new URL(superuserUrl).username || "postgres";
        const superPass = decodeURIComponent(
          new URL(superuserUrl).password || dbPassword || "postgres"
        );
        runLinuxPeerPsql(
          `ALTER USER ${quoteIdent(superUser)} WITH PASSWORD ${escapeLiteral(superPass)};`,
          { psqlBin: pgTools.psql, isRoot: sys.isRoot }
        );
        adminClient = await adminPool.connect();
      } else {
        const guidance = detectPostgresAuthGuidance(err);
        throw new Error(`${err instanceof Error ? err.message : String(err)}\n${guidance}`);
      }
    } else {
      const guidance = detectPostgresAuthGuidance(err);
      throw new Error(
        guidance
          ? `${err instanceof Error ? err.message : String(err)}\n${guidance}`
          : err instanceof Error
            ? err.message
            : String(err)
      );
    }
  }
  try {
    // 1. Create or update role
    const roleCheck = await adminClient.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [dbUser]
    );
    if (roleCheck.rowCount === 0) {
      await adminClient.query(
        `CREATE ROLE ${quoteIdent(dbUser)} WITH LOGIN PASSWORD ${escapeLiteral(dbPassword)} CREATEDB`
      );
    } else if (!directCheck.ok && dbUser !== "postgres") {
      await adminClient.query(
        `ALTER ROLE ${quoteIdent(dbUser)} WITH LOGIN PASSWORD ${escapeLiteral(dbPassword)} CREATEDB`
      );
    }

    // 2. Create main database if not exists
    const dbCheck = await adminClient.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName]
    );
    if (dbCheck.rowCount === 0) {
      await adminClient.query(
        `CREATE DATABASE ${quoteIdent(dbName)} OWNER ${quoteIdent(dbUser)}`
      );
    } else {
      await adminClient.query(
        `GRANT ALL PRIVILEGES ON DATABASE ${quoteIdent(dbName)} TO ${quoteIdent(dbUser)}`
      );
    }

    // 3. Create patchwork_test database only when in development mode
    if (createTestDb && testDbName && testDbName !== dbName) {
      const testCheck = await adminClient.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [testDbName]
      );
      if (testCheck.rowCount === 0) {
        await adminClient.query(
          `CREATE DATABASE ${quoteIdent(testDbName)} OWNER ${quoteIdent(dbUser)}`
        );
      } else {
        await adminClient.query(
          `GRANT ALL PRIVILEGES ON DATABASE ${quoteIdent(testDbName)} TO ${quoteIdent(dbUser)}`
        );
      }
    }
  } finally {
    adminClient.release();
    await adminPool.end();
  }

  // Enable required extensions (pgcrypto) and grant schema privileges on target DB
  const targetSuperUrl = new URL(superuserUrl);
  targetSuperUrl.pathname = `/${dbName}`;
  const dbSuperPool = new pg.Pool({
    connectionString: targetSuperUrl.toString(),
  });
  const dbSuperClient = await dbSuperPool.connect();
  try {
    await dbSuperClient.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await dbSuperClient.query(
      `GRANT ALL ON SCHEMA public TO ${quoteIdent(dbUser)}`
    );
  } finally {
    dbSuperClient.release();
    await dbSuperPool.end();
  }

  let testDatabaseUrl = null;
  if (createTestDb && testDbName && testDbName !== dbName) {
    const testSuperUrl = new URL(superuserUrl);
    testSuperUrl.pathname = `/${testDbName}`;
    const testSuperPool = new pg.Pool({
      connectionString: testSuperUrl.toString(),
    });
    const testSuperClient = await testSuperPool.connect();
    try {
      await testSuperClient.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
      await testSuperClient.query(
        `GRANT ALL ON SCHEMA public TO ${quoteIdent(dbUser)}`
      );
    } finally {
      testSuperClient.release();
      await testSuperPool.end();
    }
    testDatabaseUrl = buildDatabaseUrl({
      host,
      port,
      dbName: testDbName,
      dbUser,
      dbPassword,
    });
  }

  // Verify app connection
  const verify = await canConnectDatabase(appDatabaseUrl);
  if (!verify.ok) {
    throw new Error(
      `Failed to connect as '${dbUser}' to '${dbName}': ${verify.error}`
    );
  }

  return {
    databaseUrl: appDatabaseUrl,
    dbName,
    dbUser,
    testDbCreated: Boolean(createTestDb),
    testDatabaseUrl,
  };
}

export async function getMigrationStatus(
  databaseUrl,
  drizzleDir = path.join(process.cwd(), "drizzle")
) {
  const sqlFiles = fs.existsSync(drizzleDir)
    ? fs
        .readdirSync(drizzleDir)
        .filter((f) => f.endsWith(".sql"))
        .sort()
    : [];

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 3000,
  });
  try {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
      );
      const existingTables = new Set(res.rows.map((r) => r.table_name));

      const idxRes = await client.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
      );
      const existingIndexes = new Set(idxRes.rows.map((r) => r.indexname));

      const colRes = await client.query(
        `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`
      );
      const existingColumns = new Set(colRes.rows.map((r) => `${r.table_name}.${r.column_name}`));

      let appliedCount = 0;
      for (const file of sqlFiles) {
        if (file.startsWith("0000") && existingTables.has("tickets")) {
          appliedCount++;
        } else if (file.startsWith("0001") && existingTables.has("setup_state")) {
          appliedCount++;
        } else if (file.startsWith("0002") && existingTables.has("setup_token")) {
          appliedCount++;
        } else if (file.startsWith("0003") && existingTables.has("setup_credentials")) {
          appliedCount++;
        } else if (file.startsWith("0004") && existingIndexes.has("users_lower_email_idx")) {
          appliedCount++;
        } else if (file.startsWith("0005") && existingTables.has("system_settings")) {
          appliedCount++;
        } else if (file.startsWith("0006") && existingColumns.has("team_members.sub_role")) {
          appliedCount++;
        } else if (file.startsWith("0007") && existingColumns.has("tickets.due_date")) {
          appliedCount++;
        } else if (file.startsWith("0008") && existingColumns.has("team_members.sub_role")) {
          appliedCount++;
        } else if (file.startsWith("0009") && existingColumns.has("sessions.last_active_at")) {
          appliedCount++;
        } else if (file.startsWith("0010") && existingColumns.has("tickets.archived_at")) {
          appliedCount++;
        } else if (
          file.startsWith("0011") &&
          existingTables.has("domain_events") &&
          existingTables.has("ticket_watchers") &&
          existingTables.has("notifications") &&
          existingTables.has("worker_health")
        ) {
          appliedCount++;
        }
      }

      const pendingCount = Math.max(0, sqlFiles.length - appliedCount);
      const missingTables = EXPECTED_TABLES.filter(
        (t) => !existingTables.has(t)
      );

      return {
        reachable: true,
        totalMigrations: sqlFiles.length,
        appliedMigrations: appliedCount,
        pendingMigrations:
          missingTables.length > 0 && pendingCount === 0 ? 1 : pendingCount,
        missingTables,
        allTablesPresent: missingTables.length === 0,
      };
    } finally {
      client.release();
    }
  } catch (err) {
    return {
      reachable: false,
      totalMigrations: sqlFiles.length,
      appliedMigrations: 0,
      pendingMigrations: sqlFiles.length,
      missingTables: [...EXPECTED_TABLES],
      allTablesPresent: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function resolveDuplicateUserEmails(client, logsDir = path.join(process.cwd(), "logs")) {
  const tableCheck = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'`
  );
  if (tableCheck.rowCount === 0) return 0;

  const res = await client.query(`
    SELECT id, name, email, created_at
    FROM users
    WHERE lower(email) IN (
      SELECT lower(email)
      FROM users
      GROUP BY lower(email)
      HAVING count(*) > 1
    )
    ORDER BY lower(email) ASC, created_at ASC, id ASC
  `);

  if (!res.rows || res.rows.length === 0) return 0;

  const groups = new Map();
  for (const row of res.rows) {
    const key = String(row.email || "").trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const resolutions = [];
  let totalRenamed = 0;

  for (const [, userRows] of groups.entries()) {
    if (userRows.length <= 1) continue;
    const oldest = userRows[0];
    const resolution = {
      keptUser: {
        id: String(oldest.id),
        name: String(oldest.name || ""),
        email: String(oldest.email),
        createdAt: new Date(oldest.created_at).toISOString(),
      },
      renamedUsers: [],
    };

    for (let i = 1; i < userRows.length; i++) {
      const dup = userRows[i];
      const dupId = String(dup.id);
      const rawLocal = String(dup.email || "").split("@")[0].trim().toLowerCase() || "user";
      const sanitizedLocal = rawLocal.replace(/[^a-z0-9._-]/g, "") || "user";
      const newEmail = `${sanitizedLocal}+duplicate-${dupId}@invalid.local`;

      await client.query("UPDATE users SET email = $1 WHERE id = $2", [newEmail, dupId]);

      resolution.renamedUsers.push({
        id: dupId,
        name: String(dup.name || ""),
        oldEmail: String(dup.email),
        newEmail,
        createdAt: new Date(dup.created_at).toISOString(),
      });
      totalRenamed++;
    }
    resolutions.push(resolution);
  }

  if (totalRenamed > 0) {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportPath = path.join(logsDir, `duplicate-emails-${timestamp}.txt`);

    const lines = [
      `================================================================================`,
      `PATCHWORK DATABASE MIGRATION: DUPLICATE EMAIL AUDIT REPORT`,
      `Generated at: ${new Date().toISOString()}`,
      `Duplicate email groups resolved: ${resolutions.length}`,
      `Total duplicate accounts renamed: ${totalRenamed}`,
      `================================================================================`,
      ``,
      `Per database requirements, each email must belong to exactly one user.`,
      `For each duplicate email, the oldest record was preserved unchanged.`,
      `Later duplicates were renamed to an invalid placeholder (<local>+duplicate-<id>@invalid.local).`,
      ``,
      `DETAILS:`,
    ];
    for (const r of resolutions) {
      lines.push(`--------------------------------------------------------------------------------`);
      lines.push(`Email: ${r.keptUser.email.toLowerCase()}`);
      lines.push(`  [KEPT OLDEST RECORD] User ${r.keptUser.id} (${r.keptUser.name}): ${r.keptUser.email}`);
      for (const d of r.renamedUsers) {
        lines.push(`  [RENAMED DUPLICATE] User ${d.id} (${d.name}): ${d.oldEmail} -> ${d.newEmail}`);
      }
    }
    lines.push(`================================================================================`);
    fs.writeFileSync(reportPath, lines.join("\n"), "utf8");

    console.log(`\n[Database Migration] Detected ${resolutions.length} duplicate email address(es).`);
    console.log(`[Database Migration] Renamed ${totalRenamed} duplicate account(s) to unique placeholders.`);
    for (const r of resolutions) {
      for (const d of r.renamedUsers) {
        console.log(`  - Renamed "${d.name}" (${d.id}): ${d.oldEmail} -> ${d.newEmail}`);
      }
    }
    console.log(`[Database Migration] Report saved to: ${reportPath}\n`);
  }

  return totalRenamed;
}

export async function runDatabaseMigrations(
  databaseUrl,
  drizzleDir = path.join(process.cwd(), "drizzle")
) {
  const sqlFiles = fs
    .readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await resolveDuplicateUserEmails(client);
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
  } finally {
    client.release();
    await pool.end();
  }

  return verifyDatabaseSchema(databaseUrl);
}

export async function verifyDatabaseSchema(databaseUrl) {
  const status = await getMigrationStatus(databaseUrl);
  if (!status.reachable) {
    throw new Error(`Database unreachable during schema verification: ${status.error}`);
  }
  if (!status.allTablesPresent) {
    throw new Error(
      `Schema verification failed. Missing tables: ${status.missingTables.join(", ")}`
    );
  }
  return status;
}

