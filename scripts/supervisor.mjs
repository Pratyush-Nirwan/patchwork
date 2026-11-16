#!/usr/bin/env node
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  binPath,
  isPidAlive,
  killProcessTree,
} from "./lib/platform.mjs";
import { detectInstallMode, parseEnvFile } from "./setup/env.mjs";
import { canConnectDatabase, runDatabaseMigrations } from "./setup/db.mjs";
import {
  createS3Client,
  isMinioHealthy,
} from "./setup/minio.mjs";
import { CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";

export const SUPERVISOR_PID_FILE = ".patchwork-supervisor.pid";
export const MINIO_PID_FILE = ".patchwork-minio.pid";
export const APP_PID_FILE = ".patchwork.pid";

export function parseDatabaseCredentials(databaseUrl) {
  const u = new URL(databaseUrl);
  return {
    host: u.hostname || "127.0.0.1",
    port: Number(u.port || 5432),
    dbName: u.pathname.replace(/^\//, "") || "patchwork",
    dbUser: decodeURIComponent(u.username || "patchwork"),
    dbPassword: decodeURIComponent(u.password || ""),
  };
}

export function readPidRecord(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (/^\d+$/.test(raw)) {
      const pid = Number(raw);
      return { pid, alive: isPidAlive(pid) };
    }
    const parsed = JSON.parse(raw);
    return { ...parsed, alive: isPidAlive(parsed.pid) };
  } catch {
    return null;
  }
}

export async function stopSupervisorFromPidFile(projectDir = process.cwd()) {
  const supPath = path.join(projectDir, SUPERVISOR_PID_FILE);
  const appPath = path.join(projectDir, APP_PID_FILE);
  const minioPath = path.join(projectDir, MINIO_PID_FILE);

  const sup = readPidRecord(supPath);
  let stoppedAny = false;

  if (sup?.pid) {
    if (sup.alive) {
      try {
        process.kill(sup.pid, "SIGTERM");
      } catch {
        killProcessTree(sup.pid);
      }
      // Wait up to 8s for graceful reverse-order shutdown
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && isPidAlive(sup.pid)) {
        await new Promise((r) => setTimeout(r, 250));
      }
      if (isPidAlive(sup.pid)) {
        killProcessTree(sup.pid);
      }
      stoppedAny = true;
    }
    fs.rmSync(supPath, { force: true });
  }

  for (const extraPath of [appPath, minioPath]) {
    const rec = readPidRecord(extraPath);
    if (rec?.pid && rec.alive) {
      killProcessTree(rec.pid);
      stoppedAny = true;
    }
    fs.rmSync(extraPath, { force: true });
  }

  return {
    stopped: stoppedAny,
    pid: sup?.pid || null,
    reason: stoppedAny
      ? `Stopped Patchwork supervisor${sup?.pid ? ` (PID ${sup.pid})` : ""}`
      : "No running Patchwork supervisor or server found.",
  };
}

export async function getSupervisorStatus(projectDir = process.cwd()) {
  const envPath = path.join(projectDir, ".env");
  const envParsed = parseEnvFile(envPath);
  const envValues = envParsed.values;
  const mode = detectInstallMode(projectDir, envValues);
  const sup = readPidRecord(path.join(projectDir, SUPERVISOR_PID_FILE));
  const app = readPidRecord(path.join(projectDir, APP_PID_FILE));
  const minioRec = readPidRecord(path.join(projectDir, MINIO_PID_FILE));

  const dbCheck = envValues.DATABASE_URL
    ? await canConnectDatabase(envValues.DATABASE_URL)
    : { ok: false, error: "DATABASE_URL not configured" };

  const s3Endpoint = envValues.S3_ENDPOINT || "http://127.0.0.1:9000";
  const minioHealthy = await isMinioHealthy(s3Endpoint);

  const appUrl = `http://127.0.0.1:${envValues.PORT || 3000}`;
  let appHealthy = false;
  try {
    const res = await fetch(`${appUrl}/api/health`, { signal: AbortSignal.timeout(1500) });
    appHealthy = res.ok;
  } catch {
    appHealthy = false;
  }

  return {
    mode,
    supervisor: sup ? { pid: sup.pid, alive: sup.alive } : null,
    app: { pid: app?.pid || null, alive: Boolean(app?.alive), healthy: appHealthy, url: appUrl },
    postgres: { reachable: dbCheck.ok, error: dbCheck.error || null },
    minio: {
      pid: minioRec?.pid || null,
      alive: Boolean(minioRec?.alive),
      healthy: minioHealthy,
      endpoint: s3Endpoint,
    },
  };
}

async function ensureMinioBucket(endpoint, region, accessKeyId, secretAccessKey, bucket) {
  const s3 = createS3Client({ endpoint, region, accessKeyId, secretAccessKey });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

export async function startSupervisedStack({
  projectDir = process.cwd(),
  dev = false,
  stdio = "inherit",
} = {}) {
  const envPath = path.join(projectDir, ".env");
  const envParsed = parseEnvFile(envPath);
  const envValues = envParsed.values;
  const runtimeEnv = { ...envValues, ...process.env };
  const mode = detectInstallMode(projectDir, envValues);

  const nextBin = path.join(projectDir, "node_modules", "next", "dist", "bin", "next");
  const port = String(runtimeEnv.PORT || "3000");

  if (mode !== "easy") {
    const appProc = spawn(
      process.execPath,
      [nextBin, dev ? "dev" : "start", "-p", port],
      { cwd: projectDir, env: runtimeEnv, stdio, shell: false }
    );
    fs.writeFileSync(path.join(projectDir, APP_PID_FILE), String(appProc.pid), "utf8");
    const cleanup = () => {
      killProcessTree(appProc.pid);
      fs.rmSync(path.join(projectDir, APP_PID_FILE), { force: true });
    };
    process.on("SIGINT", () => { cleanup(); process.exit(0); });
    process.on("SIGTERM", () => { cleanup(); process.exit(0); });
    process.on("SIGBREAK", () => { cleanup(); process.exit(0); });
    return new Promise((resolve) => {
      appProc.on("exit", (code) => {
        fs.rmSync(path.join(projectDir, APP_PID_FILE), { force: true });
        resolve(code ?? 0);
      });
    });
  }

  // Easy mode supervision
  const supPidPath = path.join(projectDir, SUPERVISOR_PID_FILE);
  const appPidPath = path.join(projectDir, APP_PID_FILE);
  const minioPidPath = path.join(projectDir, MINIO_PID_FILE);
  const pgDataDir = path.join(projectDir, "data", "postgres");
  const minioDataDir = path.join(projectDir, "data", "minio");
  const drizzleDir = path.join(projectDir, "drizzle");

  const pgCreds = parseDatabaseCredentials(runtimeEnv.DATABASE_URL);
  const s3Endpoint = runtimeEnv.S3_ENDPOINT || "http://127.0.0.1:19000";
  const s3Url = new URL(s3Endpoint);
  const minioBindHost = runtimeEnv.MINIO_BIND_HOST || s3Url.hostname || "127.0.0.1";
  const minioApiPort = s3Url.port || "19000";
  const minioConsolePort = runtimeEnv.MINIO_CONSOLE_PORT || "19001";

  let shuttingDown = false;
  let pgHandle = null;
  let minioProc = null;
  let appProc = null;
  let pgBackoffMs = 1000;
  let minioBackoffMs = 1000;
  let pgMonitorTimer = null;

  fs.writeFileSync(
    supPidPath,
    JSON.stringify({
      pid: process.pid,
      mode: "easy",
      port: Number(port),
      pgPort: pgCreds.port,
      minioPort: Number(minioApiPort),
      consolePort: Number(minioConsolePort),
      startedAt: new Date().toISOString(),
    }),
    "utf8"
  );

  // 1. Start PostgreSQL & run pending migrations
  const { startEmbeddedPostgres } = await import("./setup/embedded-pg.mjs");
  console.log(`[supervisor] Starting embedded PostgreSQL on 127.0.0.1:${pgCreds.port}...`);
  pgHandle = await startEmbeddedPostgres({
    dataDir: pgDataDir,
    port: pgCreds.port,
    dbUser: pgCreds.dbUser,
    dbPassword: pgCreds.dbPassword,
    dbName: pgCreds.dbName,
  });
  await runDatabaseMigrations(pgHandle.databaseUrl, drizzleDir);

  // 2. Start MinIO & wait until healthy
  async function launchMinio() {
    const minioInfo = binPath("minio", { projectDir });
    if (!minioInfo.exists || !minioInfo.executable) {
      throw new Error(minioInfo.hint || "MinIO binary missing or not executable");
    }
    fs.mkdirSync(minioDataDir, { recursive: true });
    console.log(`[supervisor] Starting MinIO on ${minioBindHost}:${minioApiPort} (console 127.0.0.1:${minioConsolePort})...`);
    minioProc = spawn(
      minioInfo.path,
      [
        "server",
        minioDataDir,
        "--address",
        `${minioBindHost}:${minioApiPort}`,
        "--console-address",
        `127.0.0.1:${minioConsolePort}`,
      ],
      {
        cwd: projectDir,
        env: {
          ...runtimeEnv,
          MINIO_ROOT_USER: runtimeEnv.S3_ACCESS_KEY || "minioadmin",
          MINIO_ROOT_PASSWORD: runtimeEnv.S3_SECRET_KEY || "minioadmin",
        },
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      }
    );
    fs.writeFileSync(minioPidPath, String(minioProc.pid), "utf8");

    minioProc.on("exit", (code) => {
      if (shuttingDown) return;
      console.error(`[supervisor] MinIO exited unexpectedly (code ${code}). Restarting in ${minioBackoffMs}ms...`);
      const waitMs = minioBackoffMs;
      minioBackoffMs = Math.min(minioBackoffMs * 2, 30000);
      setTimeout(() => {
        if (!shuttingDown) {
          launchMinio().catch((err) => console.error("[supervisor] MinIO restart failed:", err.message));
        }
      }, waitMs);
    });

    for (let i = 0; i < 40; i++) {
      if (await isMinioHealthy(s3Endpoint)) {
        minioBackoffMs = 1000;
        await ensureMinioBucket(
          s3Endpoint,
          runtimeEnv.S3_REGION || "us-east-1",
          runtimeEnv.S3_ACCESS_KEY || "minioadmin",
          runtimeEnv.S3_SECRET_KEY || "minioadmin",
          runtimeEnv.S3_BUCKET || "patchwork"
        );
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`MinIO failed to become healthy on ${s3Endpoint}`);
  }

  await launchMinio();

  // Monitor embedded Postgres health & restart with backoff if needed
  pgMonitorTimer = setInterval(async () => {
    if (shuttingDown) return;
    const res = await canConnectDatabase(pgHandle.databaseUrl);
    if (res.ok) {
      pgBackoffMs = 1000;
      return;
    }
    console.error(`[supervisor] PostgreSQL health check failed (${res.error}). Restarting in ${pgBackoffMs}ms...`);
    const waitMs = pgBackoffMs;
    pgBackoffMs = Math.min(pgBackoffMs * 2, 30000);
    await new Promise((r) => setTimeout(r, waitMs));
    if (shuttingDown) return;
    try {
      pgHandle = await startEmbeddedPostgres({
        dataDir: pgDataDir,
        port: pgCreds.port,
        dbUser: pgCreds.dbUser,
        dbPassword: pgCreds.dbPassword,
        dbName: pgCreds.dbName,
      });
    } catch (err) {
      console.error("[supervisor] PostgreSQL restart error:", err.message);
    }
  }, 5000);

  // 3. Start Next.js
  console.log(`[supervisor] Starting Patchwork on http://localhost:${port}...`);
  appProc = spawn(
    process.execPath,
    [nextBin, dev ? "dev" : "start", "-p", port],
    { cwd: projectDir, env: runtimeEnv, stdio, shell: false }
  );
  fs.writeFileSync(appPidPath, String(appProc.pid), "utf8");

  async function shutdown(exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    if (pgMonitorTimer) clearInterval(pgMonitorTimer);

    console.log("[supervisor] Stopping Patchwork stack (Next.js -> MinIO -> PostgreSQL)...");
    if (appProc?.pid) {
      killProcessTree(appProc.pid);
    }
    if (minioProc?.pid) {
      killProcessTree(minioProc.pid);
    }
    if (pgHandle) {
      await pgHandle.stop().catch(() => {});
    }

    fs.rmSync(appPidPath, { force: true });
    fs.rmSync(minioPidPath, { force: true });
    fs.rmSync(supPidPath, { force: true });
    process.exit(exitCode);
  }

  process.on("SIGINT", () => { shutdown(0); });
  process.on("SIGTERM", () => { shutdown(0); });
  process.on("SIGBREAK", () => { shutdown(0); });

  return new Promise((resolve) => {
    appProc.on("exit", async (code) => {
      if (!shuttingDown) {
        await shutdown(code ?? 0);
      }
      resolve(code ?? 0);
    });
  });
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const dev = process.argv.includes("--dev");
  startSupervisedStack({ dev }).catch((err) => {
    console.error("[supervisor] Fatal error:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
