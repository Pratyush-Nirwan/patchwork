import fs from "fs";
import path from "path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { isPidAlive } from "../lib/platform.mjs";
import { isPortFree } from "./preflight.mjs";
import { buildDatabaseUrl } from "./db.mjs";

export const EMBEDDED_PG_MAJOR = 18;

export async function findFreeHighPort(startPort = 15432, host = "127.0.0.1", maxAttempts = 200) {
  for (let p = Number(startPort); p < Number(startPort) + maxAttempts; p++) {
    if (await isPortFree(p, host)) {
      return p;
    }
  }
  throw new Error(`No free port found starting at ${startPort} on ${host}`);
}

export function checkEmbeddedPgMajorVersion(dataDir) {
  const versionFile = path.join(dataDir, "PG_VERSION");
  if (!fs.existsSync(versionFile)) {
    return { initialized: false, major: null };
  }
  const raw = fs.readFileSync(versionFile, "utf8").trim();
  const major = Number(raw.split(".")[0]);
  if (major !== EMBEDDED_PG_MAJOR) {
    throw new Error(
      `Existing PostgreSQL data directory at ${dataDir} uses major version ${raw}, ` +
        `but Patchwork Easy mode expects PostgreSQL ${EMBEDDED_PG_MAJOR}. ` +
        `Refusing automatic cross-major upgrade. Back up with pg_dump and migrate manually (see /documentation/operations/backups-and-upgrades/).`
    );
  }
  return { initialized: true, major };
}

export function cleanStalePostgresPid(dataDir) {
  const pidPath = path.join(dataDir, "postmaster.pid");
  if (!fs.existsSync(pidPath)) {
    return { removed: false, reason: "absent" };
  }
  const firstLine = fs.readFileSync(pidPath, "utf8").split(/\r?\n/)[0]?.trim();
  const pid = Number(firstLine);
  if (pid && isPidAlive(pid)) {
    return { removed: false, reason: "alive", pid };
  }
  fs.rmSync(pidPath, { force: true });
  return { removed: true, reason: "stale", pid: pid || null };
}

export async function stopEmbeddedPostgresWithRetry(instance, { retries = 6, delayMs = 300 } = {}) {
  if (!instance) return;
  await instance.stop();
  // Give Windows a brief moment to release file handles after pg_ctl stop
  for (let i = 0; i < retries; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    if (!fs.existsSync(path.join(instance.databaseDir || "", "postmaster.pid"))) {
      return;
    }
  }
}

export async function startEmbeddedPostgres({
  dataDir,
  port,
  dbUser = "patchwork",
  dbPassword,
  dbName = "patchwork",
}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const versionInfo = checkEmbeddedPgMajorVersion(dataDir);
  if (versionInfo.initialized) {
    cleanStalePostgresPid(dataDir);
  }

  const instance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: dbUser,
    password: dbPassword,
    port: Number(port),
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });
  instance.databaseDir = dataDir;

  if (!versionInfo.initialized) {
    await instance.initialise();
  }
  await instance.start();

  const databaseUrl = buildDatabaseUrl({
    host: "127.0.0.1",
    port: Number(port),
    dbName,
    dbUser,
    dbPassword,
  });

  // Ensure target database exists
  const adminUrl = buildDatabaseUrl({
    host: "127.0.0.1",
    port: Number(port),
    dbName: "postgres",
    dbUser,
    dbPassword,
  });
  const pool = new pg.Pool({ connectionString: adminUrl });
  try {
    const existsRes = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (existsRes.rowCount === 0) {
      const safeIdent = `"${String(dbName).replace(/"/g, '""')}"`;
      await pool.query(`CREATE DATABASE ${safeIdent}`);
    }
  } finally {
    await pool.end();
  }

  return {
    instance,
    dataDir,
    port: Number(port),
    databaseUrl,
    stop: () => stopEmbeddedPostgresWithRetry(instance),
  };
}
