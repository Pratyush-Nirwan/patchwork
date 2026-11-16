import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import pg from "pg";
import { getMinioDownloadInfo, getSystemInfo, isPidAlive } from "../lib/platform.mjs";
import { compareSemver, getVersionInfo, DEFAULT_REPO_ROOT } from "../lib/version.mjs";
import { detectInstallMode, parseEnvFile, validateEnvValues } from "./env.mjs";
import { parseSha256Sum, sha256File } from "./download.mjs";
import { getMigrationStatus } from "./db.mjs";
import { checkMinioBinary } from "./preflight.mjs";
import { checkMinioBucketReachable } from "./minio.mjs";
import { decryptAdminToken } from "./token.mjs";

function checkLinuxServices() {
  const sys = getSystemInfo();
  if (!sys.isLinux) {
    return {
      supported: false,
      patchworkActive: false,
      minioActive: false,
      summary: `Skipped (${sys.platform} — systemd is Linux-only)`,
    };
  }
  const isServiceActive = (name) => {
    try {
      const out = execFileSync("systemctl", ["is-active", name], {
        stdio: ["ignore", "pipe", "ignore"],
        shell: false,
      })
        .toString()
        .trim();
      return out === "active";
    } catch {
      return false;
    }
  };
  const patchworkActive = isServiceActive("patchwork.service");
  const minioActive = isServiceActive("minio.service");
  return {
    supported: true,
    patchworkActive,
    minioActive,
    summary: `patchwork: ${patchworkActive ? "running" : "stopped"}, minio: ${minioActive ? "running" : "stopped"}`,
  };
}

export async function detectInstallState(options = {}) {
  const projectDir = options.projectDir || process.cwd();
  const envPath = options.envPath || path.join(projectDir, ".env");
  const envParsed = parseEnvFile(envPath);
  const mode = detectInstallMode(projectDir, envParsed.values);
  const minioDataDir =
    options.minioDataDir ||
    path.join(projectDir, mode === "easy" ? "data/minio" : ".minio-data");
  const drizzleDir =
    options.drizzleDir || path.join(process.cwd(), "drizzle");

  // 1. .env check
  const envValidation = envParsed.exists
    ? validateEnvValues(envParsed.values)
    : { valid: false, missing: [], validEncryptionKey: false };

  const databaseUrl =
    options.databaseUrl ||
    envParsed.values.DATABASE_URL ||
    "";

  const s3Endpoint =
    options.s3Endpoint ||
    envParsed.values.S3_ENDPOINT ||
    "http://127.0.0.1:9000";
  const s3Region =
    options.s3Region || envParsed.values.S3_REGION || "us-east-1";
  const s3AccessKey =
    options.s3AccessKey || envParsed.values.S3_ACCESS_KEY || "minioadmin";
  const s3SecretKey =
    options.s3SecretKey || envParsed.values.S3_SECRET_KEY || "minioadmin";
  const s3Bucket =
    options.s3Bucket || envParsed.values.S3_BUCKET || "patchwork";
  const encryptionKey =
    options.tokenEncryptionKey !== undefined
      ? options.tokenEncryptionKey
      : envParsed.values.TOKEN_ENCRYPTION_KEY || "";

  // 2. Database & migrations check
  let dbReachable = false;
  let roleExists = false;
  let databaseExists = false;
  let migrationStatus = {
    reachable: false,
    totalMigrations: 3,
    appliedMigrations: 0,
    pendingMigrations: 3,
    missingTables: [],
    allTablesPresent: false,
  };

  let tokenState = {
    exists: false,
    confirmed: false,
    consumed: false,
    keyPresent: Boolean(encryptionKey),
    decryptable: false,
    error: null,
  };

  let wizardCompleted = false;

  if (databaseUrl) {
    migrationStatus = await getMigrationStatus(databaseUrl, drizzleDir);
    if (migrationStatus.reachable) {
      dbReachable = true;
      roleExists = true;
      databaseExists = true;

      const pool = new pg.Pool({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 2500,
      });
      try {
        const client = await pool.connect();
        try {
          if (!migrationStatus.missingTables.includes("setup_token")) {
            const tokRes = await client.query(
              `SELECT ciphertext, iv, auth_tag, key_version, created_at, confirmed_at, consumed_at FROM setup_token WHERE id = 'default' LIMIT 1`
            );
            if (tokRes.rowCount > 0) {
              const row = tokRes.rows[0];
              tokenState.exists = true;
              tokenState.consumed = Boolean(row.consumed_at);
              tokenState.confirmed = Boolean(row.confirmed_at || row.consumed_at);
              if (tokenState.consumed) {
                tokenState.decryptable = true;
              } else if (!tokenState.confirmed) {
                tokenState.decryptable = false;
                tokenState.error =
                  "Admin setup token was never confirmed as saved";
              } else if (!encryptionKey) {
                tokenState.decryptable = false;
                tokenState.error = "TOKEN_ENCRYPTION_KEY is missing in .env";
              } else {
                try {
                  decryptAdminToken(
                    {
                      ciphertext: row.ciphertext,
                      iv: row.iv,
                      authTag: row.auth_tag,
                    },
                    encryptionKey
                  );
                  tokenState.decryptable = true;
                } catch (err) {
                  tokenState.decryptable = false;
                  tokenState.error =
                    err instanceof Error ? err.message : "Decryption failed";
                }
              }
            }
          }

          if (!migrationStatus.missingTables.includes("setup_state")) {
            const wizRes = await client.query(
              `SELECT is_completed FROM setup_state WHERE id = 'default' LIMIT 1`
            );
            if (wizRes.rowCount > 0) {
              wizardCompleted = Boolean(wizRes.rows[0].is_completed);
            }
          }
        } finally {
          client.release();
        }
      } catch {
        // Ignore query error if table missing
      } finally {
        await pool.end().catch(() => {});
      }
    }
  }

  // 3. MinIO check
  const minioBinaryCheck = checkMinioBinary(projectDir);
  const minioDataDirExists = fs.existsSync(minioDataDir);
  const minioBucketStatus = envParsed.exists || options.checkMinioAnyway
    ? await checkMinioBucketReachable({
        endpoint: s3Endpoint,
        region: s3Region,
        accessKeyId: s3AccessKey,
        secretAccessKey: s3SecretKey,
        bucket: s3Bucket,
      })
    : { reachable: false, bucketExists: false };

  // 4. Linux services
  const services = checkLinuxServices();

  // 4b. Embedded documentation build
  const docsDistDir = path.join(projectDir, "documentation-dist");
  const docsIndexPath = path.join(docsDistDir, "index.html");
  const docsBuildInfoPath = path.join(docsDistDir, ".build-info.json");
  let docsBuildInfo = null;
  if (fs.existsSync(docsBuildInfoPath)) {
    try {
      docsBuildInfo = JSON.parse(fs.readFileSync(docsBuildInfoPath, "utf8"));
    } catch {
      docsBuildInfo = null;
    }
  }
  const docsBuilt = fs.existsSync(docsIndexPath);

  // 4c. App version (disk vs installed)
  const diskPkgDir = fs.existsSync(path.join(projectDir, "package.json"))
    ? projectDir
    : DEFAULT_REPO_ROOT;
  const diskVersionInfo = getVersionInfo(diskPkgDir);
  const installedVersionPath = path.join(projectDir, ".patchwork-version.json");
  let installedVersion = options.installedVersion || null;
  if (!installedVersion && fs.existsSync(installedVersionPath)) {
    try {
      const parsedVer = JSON.parse(fs.readFileSync(installedVersionPath, "utf8"));
      installedVersion = parsedVer?.version || null;
    } catch {
      installedVersion = null;
    }
  }
  if (!installedVersion && docsBuildInfo?.version) {
    installedVersion = docsBuildInfo.version;
  }
  const upgradeAvailable = Boolean(
    installedVersion &&
      compareSemver(installedVersion, diskVersionInfo.version) !== null &&
      compareSemver(installedVersion, diskVersionInfo.version) < 0
  );

  // 5. Overall state classification: "fresh" | "partial" | "complete"
  const nothingInstalled = !envParsed.exists && !databaseExists;
  const everythingHealthy =
    envParsed.exists &&
    envValidation.valid &&
    dbReachable &&
    databaseExists &&
    migrationStatus.pendingMigrations === 0 &&
    migrationStatus.allTablesPresent &&
    minioBinaryCheck.passed &&
    minioDataDirExists &&
    minioBucketStatus.reachable &&
    minioBucketStatus.bucketExists &&
    tokenState.exists &&
    tokenState.confirmed &&
    tokenState.decryptable;

  const overallState = nothingInstalled
    ? "fresh"
    : everythingHealthy
      ? "complete"
      : "partial";

  // Easy-mode specific status
  const pgDataDir = path.join(projectDir, "data", "postgres");
  const pgVersionFile = path.join(pgDataDir, "PG_VERSION");
  const pgMajorVersion = fs.existsSync(pgVersionFile)
    ? fs.readFileSync(pgVersionFile, "utf8").trim()
    : null;
  const supPidPath = path.join(projectDir, ".patchwork-supervisor.pid");
  let supervisorAlive = false;
  let supervisorPid = null;
  if (fs.existsSync(supPidPath)) {
    try {
      const parsedSup = JSON.parse(fs.readFileSync(supPidPath, "utf8"));
      supervisorPid = parsedSup.pid || null;
      supervisorAlive = supervisorPid ? isPidAlive(supervisorPid) : false;
    } catch {}
  }

  let minioChecksumStatus = "unverified";
  const dlInfo = getMinioDownloadInfo();
  const cachedSumPath = path.join(projectDir, "data", "cache", `${dlInfo.assetName}.sha256sum`);
  if (minioBinaryCheck.passed && fs.existsSync(cachedSumPath)) {
    try {
      const expected = parseSha256Sum(fs.readFileSync(cachedSumPath, "utf8"));
      const actual = await sha256File(minioBinaryCheck.binaryPath);
      minioChecksumStatus = actual === expected ? "verified" : "mismatch";
    } catch {
      minioChecksumStatus = "unverified";
    }
  }

  const calcDirBytes = (dir) => {
    if (!fs.existsSync(dir)) return 0;
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) total += calcDirBytes(p);
      else if (entry.isFile()) total += fs.statSync(p).size;
    }
    return total;
  };
  const dataDiskBytes = mode === "easy" ? calcDirBytes(path.join(projectDir, "data")) : 0;

  return {
    mode,
    overallState,
    easy: {
      pgDataDir,
      pgMajorVersion,
      minioDataDir,
      minioChecksumStatus,
      dataDiskBytes,
      supervisorPid,
      supervisorAlive,
    },
    env: {
      path: envPath,
      exists: envParsed.exists,
      valid: envValidation.valid,
      missingKeys: envValidation.missing,
      validEncryptionKey: envValidation.validEncryptionKey,
      values: envParsed.values,
    },
    database: {
      url: databaseUrl,
      reachable: dbReachable,
      roleExists,
      databaseExists,
    },
    migrations: migrationStatus,
    minio: {
      binaryPresent: minioBinaryCheck.passed,
      binaryPath: minioBinaryCheck.binaryPath,
      dataDir: minioDataDir,
      dataDirExists: minioDataDirExists,
      endpoint: s3Endpoint,
      bucket: s3Bucket,
      reachable: minioBucketStatus.reachable,
      bucketExists: minioBucketStatus.bucketExists,
    },
    token: tokenState,
    wizard: {
      completed: wizardCompleted,
    },
    docs: {
      built: docsBuilt,
      version: docsBuildInfo?.version || null,
      base: docsBuildInfo?.base || null,
      builtAt: docsBuildInfo?.builtAt || null,
    },
    diskVersion: diskVersionInfo.version,
    diskDisplayVersion: diskVersionInfo.displayVersion,
    installedVersion,
    installedDisplayVersion: installedVersion ? `v${installedVersion.replace(/^v/, "")}` : null,
    upgradeAvailable,
    services,
  };
}

export function formatStateTable(state) {
  const sym = (ok) => (ok ? "✔" : "✖");
  const versionSummary = state.upgradeAvailable
    ? `⚠ ${state.diskDisplayVersion || ""} (installed ${state.installedDisplayVersion}) — Upgrade available: run migrations (/documentation/operations/backups-and-upgrades/)`
    : state.installedDisplayVersion
      ? `✔ ${state.diskDisplayVersion} (installed ${state.installedDisplayVersion})`
      : `${state.diskDisplayVersion || "unknown"}`;
  const rows = [
    ["Install mode", state.mode === "easy" ? "Easy (managed PostgreSQL + MinIO)" : "Advanced (external services)"],
    ["App version (disk / installed)", versionSummary],
    [
      ".env configuration",
      state.env.exists && state.env.valid ? "✔ Valid" : state.env.exists ? `⚠ Missing: ${state.env.missingKeys.join(", ")}` : "✖ Not found",
    ],
    [
      "PostgreSQL database & role",
      state.database.reachable && state.database.databaseExists
        ? "✔ Reachable"
        : "✖ Unreachable / missing",
    ],
    [
      "Database migrations",
      state.migrations.reachable
        ? state.migrations.pendingMigrations === 0
          ? `✔ Applied (${state.migrations.appliedMigrations}/${state.migrations.totalMigrations}, 0 pending)`
          : `⚠ ${state.migrations.pendingMigrations} pending (${state.migrations.appliedMigrations}/${state.migrations.totalMigrations} applied)`
        : "✖ Database not connected",
    ],
    [
      "MinIO binary, data dir & bucket",
      `${sym(state.minio.binaryPresent)} binary, ${sym(state.minio.dataDirExists)} data dir, ${sym(state.minio.bucketExists)} bucket '${state.minio.bucket}'`,
    ],
    [
      "Admin setup_token & encryption key",
      state.token.exists
        ? state.token.consumed
          ? "✔ Consumed (admin registered)"
          : !state.token.confirmed
            ? "✖ Unconfirmed token (Reset required)"
            : state.token.decryptable
              ? "✔ Unconsumed & decryptable"
              : `✖ Key mismatch/missing (${state.token.error || "cannot decrypt"})`
        : "✖ Missing setup_token row",
    ],
    [
      "Browser wizard complete flag",
      state.wizard.completed ? "✔ Completed" : "⚠ Incomplete (pending browser wizard)",
    ],
    [
      "Embedded documentation",
      state.docs?.built
        ? `✔ Built (v${state.docs.version || "?"}, base=${state.docs.base || "/documentation"})`
        : "⚠ Not built (run npm run docs:build)",
    ],
    ["Systemd services (Linux)", state.services.summary],
  ];
  if (state.mode === "easy" && state.easy) {
    const mb = (state.easy.dataDiskBytes / (1024 * 1024)).toFixed(1);
    rows.push([
      "Easy mode PG & MinIO checksum",
      `PG ${state.easy.pgMajorVersion || "uninitialized"} | MinIO SHA-256: ${state.easy.minioChecksumStatus} | ./data: ${mb} MB`,
    ]);
    rows.push([
      "Supervisor status",
      state.easy.supervisorAlive ? `✔ Running (PID ${state.easy.supervisorPid})` : "Stopped",
    ]);
  }

  const width = 36;
  const lines = [
    `Detected Install State: ${state.overallState.toUpperCase()}`,
    "─".repeat(78),
  ];
  for (const [label, val] of rows) {
    lines.push(`${label.padEnd(width, " ")} │ ${val}`);
  }
  lines.push("─".repeat(78));
  return lines.join("\n");
}

