import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { detectInstallState } from "./state-detect.mjs";
import { runPreflightChecks } from "./preflight.mjs";
import {
  detectInstallMode,
  parseEnvFile,
  writeEnvFileAtomic,
  generateRandomSecret,
} from "./env.mjs";
import { provisionDatabase, runDatabaseMigrations } from "./db.mjs";
import { isMinioHealthy, setupMinioBucketAndVerify } from "./minio.mjs";
import { ensureMinioBinary } from "./download.mjs";
import { cleanStalePostgresPid, startEmbeddedPostgres } from "./embedded-pg.mjs";
import { killProcessTree } from "../lib/platform.mjs";
import { parseDatabaseCredentials } from "../supervisor.mjs";

export async function runRepair(options = {}) {
  const projectDir = options.projectDir || process.cwd();
  const envPath = options.envPath || path.join(projectDir, ".env");
  const envPre = parseEnvFile(envPath);
  const mode = options.mode || detectInstallMode(projectDir, envPre.values);
  const minioDataDir =
    options.minioDataDir ||
    path.join(projectDir, mode === "easy" ? "data/minio" : ".minio-data");
  const drizzleDir = options.drizzleDir || path.join(process.cwd(), "drizzle");
  const superuserUrl =
    options.superuserUrl ||
    process.env.SETUP_PG_SUPERUSER_URL ||
    "postgres://postgres:postgres@localhost:5432/postgres";

  const found = [];
  const fixed = [];
  const manualActions = [];

  if (mode === "easy") {
    const pgDataDir = path.join(projectDir, "data", "postgres");
    const pidClean = cleanStalePostgresPid(pgDataDir);
    if (pidClean.removed) {
      found.push(`Stale PostgreSQL postmaster.pid (${pidClean.pid || "unknown"})`);
      fixed.push("Removed stale PostgreSQL postmaster.pid");
    }
    for (const staleFile of [".patchwork.pid", ".patchwork-minio.pid", ".patchwork-supervisor.pid"]) {
      const p = path.join(projectDir, staleFile);
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, "utf8").trim();
          const pid = /^\d+$/.test(raw) ? Number(raw) : JSON.parse(raw).pid;
          if (!pid) {
            fs.rmSync(p, { force: true });
          }
        } catch {
          fs.rmSync(p, { force: true });
        }
      }
    }

    const binCheck = await ensureMinioBinary({
      projectDir,
      yes: options.yes ?? true,
    });
    if (binCheck.downloaded || binCheck.source === "cache") {
      found.push("MinIO binary missing or corrupted");
      fixed.push(`Restored & verified MinIO binary (${binCheck.source})`);
    }

    const currentValues = { ...envPre.values };
    if (currentValues.DATABASE_URL) {
      const creds = parseDatabaseCredentials(currentValues.DATABASE_URL);
      let tempPg = null;
      try {
        tempPg = await startEmbeddedPostgres({
          dataDir: pgDataDir,
          port: creds.port,
          dbUser: creds.dbUser,
          dbPassword: creds.dbPassword,
          dbName: creds.dbName,
        });
        const migStatus = await detectInstallState({
          projectDir,
          envPath,
          minioDataDir,
          drizzleDir,
          databaseUrl: tempPg.databaseUrl,
        });
        if (migStatus.migrations.pendingMigrations > 0 || !migStatus.migrations.allTablesPresent) {
          found.push(`${migStatus.migrations.pendingMigrations} pending migration(s)`);
          await runDatabaseMigrations(tempPg.databaseUrl, drizzleDir);
          fixed.push("Applied pending database migrations");
        }
      } catch (err) {
        found.push(`Embedded PostgreSQL issue: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (tempPg) await tempPg.stop().catch(() => {});
      }
    }

    const s3Endpoint = currentValues.S3_ENDPOINT || "http://127.0.0.1:19000";
    let tempMinioPid = null;
    try {
      if (!(await isMinioHealthy(s3Endpoint))) {
        const u = new URL(s3Endpoint);
        const { spawn } = await import("child_process");
        fs.mkdirSync(minioDataDir, { recursive: true });
        const mProc = spawn(
          binCheck.path,
          [
            "server",
            minioDataDir,
            "--address",
            `${u.hostname}:${u.port || 19000}`,
            "--console-address",
            `127.0.0.1:${currentValues.MINIO_CONSOLE_PORT || 19001}`,
          ],
          {
            cwd: projectDir,
            env: {
              ...process.env,
              MINIO_ROOT_USER: currentValues.S3_ACCESS_KEY || "patchwork",
              MINIO_ROOT_PASSWORD: currentValues.S3_SECRET_KEY || "minioadmin",
            },
            stdio: "ignore",
            windowsHide: true,
            shell: false,
          }
        );
        tempMinioPid = mProc.pid;
        for (let i = 0; i < 40; i++) {
          if (await isMinioHealthy(s3Endpoint)) break;
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      await setupMinioBucketAndVerify({
        projectDir,
        dataDir: minioDataDir,
        endpoint: s3Endpoint,
        consolePort: Number(currentValues.MINIO_CONSOLE_PORT || 19001),
        region: currentValues.S3_REGION || "us-east-1",
        accessKeyId: currentValues.S3_ACCESS_KEY || "patchwork",
        secretAccessKey: currentValues.S3_SECRET_KEY || "minioadmin",
        bucket: currentValues.S3_BUCKET || "patchwork",
      });
      fixed.push(`Verified MinIO data directory and bucket '${currentValues.S3_BUCKET || "patchwork"}'`);
    } finally {
      if (tempMinioPid) {
        killProcessTree(tempMinioPid);
        await new Promise((r) => setTimeout(r, 350));
      }
    }

    const finalState = await detectInstallState({
      projectDir,
      envPath,
      minioDataDir,
      drizzleDir,
      checkMinioAnyway: true,
    });
    if (finalState.worker && finalState.worker.deadLetterEvents > 0) {
    found.push(
      `Background worker has ${finalState.worker.deadLetterEvents} dead-lettered domain event(s)`
    );
    manualActions.push(
      "Inspect System Configuration -> Health for background worker errors and dead-lettered events."
    );
  }

  return { found, fixed, manualActions, envBackupPath: null, state: finalState };
  }

  const preflight = await runPreflightChecks({
    projectDir,
    minioDataDir,
    pgConnectionUrl: superuserUrl,
    allowRunningMinio: true,
    allowRunningApp: true,
  });

  for (const check of preflight.checks) {
    if (!check.passed) {
      found.push(`Preflight issue: ${check.label} (${check.detail})`);
    }
  }

  const initialState = await detectInstallState({
    projectDir,
    envPath,
    minioDataDir,
    drizzleDir,
    checkMinioAnyway: true,
    installedVersion: options.installedVersion,
  });

  if (initialState.upgradeAvailable) {
    const msg = `Upgrade available: run migrations (installed ${initialState.installedDisplayVersion} -> disk ${initialState.diskDisplayVersion}). Run 'npm run db:migrate' and see https://getpatchwork.in/documentation/operations/backups-and-upgrades/.`;
    found.push(msg);
    manualActions.push(msg);
  }

  // 1. Inspect .env without regenerating existing secrets or TOKEN_ENCRYPTION_KEY
  const envParsed = parseEnvFile(envPath);
  const currentValues = { ...envParsed.values };
  let envNeedsUpdate = false;

  const defaults = {
    DATABASE_URL:
      options.databaseUrl ||
      currentValues.DATABASE_URL ||
      "postgres://patchwork:patchwork@localhost:5432/patchwork",
    PORT: currentValues.PORT || String(options.appPort || 3000),
    APP_URL:
      currentValues.APP_URL ||
      options.appUrl ||
      `http://localhost:${currentValues.PORT || options.appPort || 3000}`,
    S3_ENDPOINT:
      currentValues.S3_ENDPOINT ||
      options.s3Endpoint ||
      "http://127.0.0.1:9000",
    S3_REGION: currentValues.S3_REGION || "us-east-1",
    S3_ACCESS_KEY:
      currentValues.S3_ACCESS_KEY || options.s3AccessKey || "minioadmin",
    S3_SECRET_KEY:
      currentValues.S3_SECRET_KEY || options.s3SecretKey || "minioadmin",
    S3_BUCKET: currentValues.S3_BUCKET || options.s3Bucket || "patchwork",
    MAX_ATTACHMENT_BYTES: currentValues.MAX_ATTACHMENT_BYTES || "10485760",
  };

  for (const [k, defVal] of Object.entries(defaults)) {
    if (!currentValues[k]) {
      found.push(`Missing .env key: ${k}`);
      currentValues[k] = defVal;
      envNeedsUpdate = true;
    }
  }

  if (!currentValues.SESSION_SECRET) {
    found.push("Missing .env key: SESSION_SECRET");
    currentValues.SESSION_SECRET = generateRandomSecret(32);
    envNeedsUpdate = true;
  }
  if (!currentValues.CSRF_SECRET) {
    found.push("Missing .env key: CSRF_SECRET");
    currentValues.CSRF_SECRET = generateRandomSecret(32);
    envNeedsUpdate = true;
  }

  // Never generate or overwrite TOKEN_ENCRYPTION_KEY during Repair
  if (!currentValues.TOKEN_ENCRYPTION_KEY) {
    found.push("TOKEN_ENCRYPTION_KEY is missing from .env");
    manualActions.push(
      "TOKEN_ENCRYPTION_KEY is missing in .env. Setup step 1 is blocked; the only fix is to run Reset (`npm run setup` -> Reset)."
    );
  }

  let envBackupPath = null;
  if (envNeedsUpdate) {
    const writeRes = writeEnvFileAtomic(envPath, currentValues, {
      backup: true,
    });
    envBackupPath = writeRes.backupPath;
    fixed.push(
      `Restored missing .env keys${envBackupPath ? ` (backed up previous .env to ${path.basename(envBackupPath)})` : ""}`
    );
  } else if (envParsed.exists) {
    try {
      fs.chmodSync(envPath, 0o600);
    } catch {
      // Ignore on Windows
    }
  }

  // 2. Database & Role check
  const databaseUrl = currentValues.DATABASE_URL;
  if (!initialState.database.reachable || !initialState.database.databaseExists) {
    found.push("Database or role unreachable/missing");
    const parsedDb = new URL(databaseUrl);
    const dbName = decodeURIComponent(parsedDb.pathname.replace(/^\//, ""));
    const dbUser = decodeURIComponent(parsedDb.username || "patchwork");
    const dbPassword = decodeURIComponent(parsedDb.password || "patchwork");
    const host = parsedDb.hostname || "localhost";
    const port = Number(parsedDb.port || 5432);

    const envTestPath = options.envTestPath || path.join(projectDir, ".env.test");
    const isDevMode = Boolean(options.devMode || fs.existsSync(envTestPath));

    await provisionDatabase({
      superuserUrl,
      host,
      port,
      dbName,
      dbUser,
      dbPassword,
      createTestDb: isDevMode,
    });
    fixed.push(`Recreated missing database/role '${dbName}' and enabled pgcrypto`);
  }

  // 3. Pending migrations check
  const postDbState = await detectInstallState({
    projectDir,
    envPath,
    minioDataDir,
    drizzleDir,
    databaseUrl,
  });

  if (
    postDbState.migrations.pendingMigrations > 0 ||
    !postDbState.migrations.allTablesPresent
  ) {
    found.push(
      `${postDbState.migrations.pendingMigrations} pending migration(s) / missing tables (${postDbState.migrations.missingTables.join(", ")})`
    );
    await runDatabaseMigrations(databaseUrl, drizzleDir);
    fixed.push("Applied pending database migrations");
  }

  // 4. MinIO data dir & bucket check
  if (!initialState.minio.dataDirExists || !initialState.minio.bucketExists) {
    found.push(
      `MinIO missing ${!initialState.minio.dataDirExists ? "data directory" : "bucket"} '${currentValues.S3_BUCKET}'`
    );
    await setupMinioBucketAndVerify({
      projectDir,
      dataDir: minioDataDir,
      endpoint: currentValues.S3_ENDPOINT,
      region: currentValues.S3_REGION,
      accessKeyId: currentValues.S3_ACCESS_KEY,
      secretAccessKey: currentValues.S3_SECRET_KEY,
      bucket: currentValues.S3_BUCKET,
    });
    fixed.push(
      `Restored MinIO data directory and bucket '${currentValues.S3_BUCKET}'`
    );
  }

  // 4b. Embedded documentation build check
  const webPkg = path.join(projectDir, "website", "package.json");
  const buildEmbeddedScript = path.join(projectDir, "scripts", "docs", "build-embedded.mjs");
  if (!initialState.docs?.built && fs.existsSync(webPkg) && fs.existsSync(buildEmbeddedScript) && process.env.SKIP_DOCS_BUILD !== "1") {
    found.push("Embedded documentation bundle (documentation-dist/) is missing");
    execFileSync(process.execPath, [buildEmbeddedScript], {
      cwd: projectDir,
      stdio: "pipe",
      windowsHide: true,
    });
    fixed.push("Rebuilt embedded documentation bundle (documentation-dist/)");
  }

  // 5. Inspect setup_token & encryption key health (never regenerate token or key!)
  const finalState = await detectInstallState({
    projectDir,
    envPath,
    minioDataDir,
    drizzleDir,
    databaseUrl,
    checkMinioAnyway: true,
  });

  const troubleshootUrl = "https://getpatchwork.in/documentation/operations/troubleshooting/";

  if (!finalState.token.exists && !finalState.wizard.completed) {
    found.push("Admin setup_token row is missing in database");
    manualActions.push(
      `Admin setup_token is missing and cannot be re-issued by Repair. The only fix is to run Reset (\`npm run setup\` -> Reset). See ${troubleshootUrl}`
    );
  } else if (
    finalState.token.exists &&
    !finalState.token.consumed &&
    !finalState.token.confirmed
  ) {
    found.push("Admin setup_token was generated previously but never confirmed as saved");
    manualActions.push(
      `Admin setup_token was never confirmed as saved and cannot be re-displayed. The only fix is to run Reset (\`npm run setup\` -> Reset). See ${troubleshootUrl}`
    );
  } else if (
    finalState.token.exists &&
    !finalState.token.consumed &&
    !finalState.token.decryptable
  ) {
    if (!found.some((f) => f.includes("TOKEN_ENCRYPTION_KEY"))) {
      found.push(
        `TOKEN_ENCRYPTION_KEY failed to decrypt setup_token (${finalState.token.error || "invalid key"})`
      );
    }
    if (!manualActions.some((m) => m.includes("only fix is to run Reset"))) {
      manualActions.push(
        `TOKEN_ENCRYPTION_KEY is missing or wrong and cannot decrypt setup_token. Setup step 1 is blocked; the only fix is to run Reset (\`npm run setup\` -> Reset). See ${troubleshootUrl}`
      );
    }
  }

  if (finalState.worker && finalState.worker.deadLetterEvents > 0) {
    found.push(
      `Background worker has ${finalState.worker.deadLetterEvents} dead-lettered domain event(s)`
    );
    manualActions.push(
      "Inspect System Configuration -> Health for background worker errors and dead-lettered events."
    );
  }

  return {
    found,
    fixed,
    manualActions,
    envBackupPath,
    state: finalState,
  };
}

