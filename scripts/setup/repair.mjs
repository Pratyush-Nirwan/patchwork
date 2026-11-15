import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { detectInstallState } from "./state-detect.mjs";
import { runPreflightChecks } from "./preflight.mjs";
import {
  parseEnvFile,
  writeEnvFileAtomic,
  generateRandomSecret,
} from "./env.mjs";
import { provisionDatabase, runDatabaseMigrations } from "./db.mjs";
import { setupMinioBucketAndVerify } from "./minio.mjs";

export async function runRepair(options = {}) {
  const projectDir = options.projectDir || process.cwd();
  const envPath = options.envPath || path.join(projectDir, ".env");
  const minioDataDir =
    options.minioDataDir || path.join(projectDir, ".minio-data");
  const drizzleDir = options.drizzleDir || path.join(process.cwd(), "drizzle");
  const superuserUrl =
    options.superuserUrl ||
    process.env.SETUP_PG_SUPERUSER_URL ||
    "postgres://postgres:postgres@localhost:5432/postgres";

  const found = [];
  const fixed = [];
  const manualActions = [];

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
    const msg = `Upgrade available: run migrations (installed ${initialState.installedDisplayVersion} -> disk ${initialState.diskDisplayVersion}). Run 'npm run db:migrate' and see /documentation/operations/backups-and-upgrades/.`;
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
  const docsSitePkg = path.join(projectDir, "docs-site", "package.json");
  const astroBin = path.join(projectDir, "docs-site", "node_modules", "astro", "astro.js");
  const copyDistScript = path.join(projectDir, "scripts", "docs", "copy-dist.mjs");
  if (!initialState.docs?.built && fs.existsSync(docsSitePkg) && fs.existsSync(astroBin) && fs.existsSync(copyDistScript)) {
    found.push("Embedded documentation bundle (documentation-dist/) is missing");
    execFileSync(process.execPath, [astroBin, "build"], {
      cwd: path.join(projectDir, "docs-site"),
      env: { ...process.env, DOCS_BASE: "/documentation" },
      stdio: "pipe",
      windowsHide: true,
    });
    execFileSync(process.execPath, [copyDistScript], {
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

  const appUrl = (currentValues.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const troubleshootUrl = `${appUrl}/documentation/operations/troubleshooting/`;

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

  return {
    found,
    fixed,
    manualActions,
    envBackupPath,
    state: finalState,
  };
}

