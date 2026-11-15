import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import pg from "pg";
import {
  parseEnvFile,
  backupEnvFileIfExists,
  buildFreshEnvValues,
  writeEnvFileAtomic,
  generateStrongPassword,
} from "./env.mjs";
import { provisionDatabase, runDatabaseMigrations } from "./db.mjs";
import {
  emptyAndRemoveMinioBucket,
  setupMinioBucketAndVerify,
} from "./minio.mjs";
import {
  createAndStoreAdminToken,
  generateTokenEncryptionKeyHex,
} from "./token.mjs";

function quoteIdent(ident) {
  return `"${String(ident).replace(/"/g, '""')}"`;
}

export function getDeletionTargetsSummary({
  dbName,
  s3Bucket,
  minioDataDir,
  envPath,
}) {
  return [
    `PostgreSQL database: ${dbName} (including all tickets, users, setup_state, and setup_token)`,
    `MinIO bucket & objects: ${s3Bucket} (${minioDataDir})`,
    `Environment file: ${envPath} (and existing TOKEN_ENCRYPTION_KEY)`,
    `Admin setup token & browser setup wizard state`,
  ];
}

export async function performBackup({
  databaseUrl,
  minioDataDir,
  backupsDir = path.join(process.cwd(), "backups"),
  backupDb = false,
  backupMinio = false,
  timestamp = Date.now(),
}) {
  const result = { dbBackupPath: null, minioBackupPath: null };
  if (!backupDb && !backupMinio) return result;

  fs.mkdirSync(backupsDir, { recursive: true });

  if (backupDb && databaseUrl) {
    const sqlPath = path.join(backupsDir, `patchwork-${timestamp}.sql`);
    try {
      const dumpOut = execFileSync("pg_dump", [databaseUrl], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      fs.writeFileSync(sqlPath, dumpOut);
      result.dbBackupPath = sqlPath;
    } catch {
      // Fallback SQL snapshot if pg_dump is not on PATH
      fs.writeFileSync(
        sqlPath,
        `-- Patchwork backup snapshot created at ${new Date(timestamp).toISOString()}\n`,
        "utf8"
      );
      result.dbBackupPath = sqlPath;
    }
  }

  if (backupMinio && minioDataDir && fs.existsSync(minioDataDir)) {
    const targetMinioBackup = path.join(backupsDir, `minio-${timestamp}`);
    fs.cpSync(minioDataDir, targetMinioBackup, { recursive: true });
    result.minioBackupPath = targetMinioBackup;
  }

  return result;
}

export async function runFreshInstall(options = {}) {
  const projectDir = options.projectDir || process.cwd();
  const envPath = options.envPath || path.join(projectDir, ".env");
  const minioDataDir =
    options.minioDataDir || path.join(projectDir, ".minio-data");
  const drizzleDir = options.drizzleDir || path.join(process.cwd(), "drizzle");

  const superuserUrl =
    options.superuserUrl ||
    process.env.SETUP_PG_SUPERUSER_URL ||
    "postgres://postgres:postgres@localhost:5432/postgres";

  const dbHost = options.dbHost || process.env.SETUP_DB_HOST || "localhost";
  const dbPort = Number(options.dbPort || process.env.SETUP_DB_PORT || 5432);
  const dbName = options.dbName || process.env.SETUP_DB_NAME || "patchwork";
  const dbUser = options.dbUser || process.env.SETUP_DB_USER || "patchwork";
  const dbPassword =
    options.dbPassword ||
    process.env.SETUP_DB_PASSWORD ||
    generateStrongPassword(20);
  const createTestDb = Boolean(options.devMode || options.createTestDb);

  const appPort = Number(options.appPort || process.env.SETUP_APP_PORT || 3000);
  const appUrl =
    options.appUrl ||
    process.env.SETUP_APP_URL ||
    `http://localhost:${appPort}`;

  const s3Endpoint =
    options.s3Endpoint ||
    process.env.SETUP_S3_ENDPOINT ||
    "http://127.0.0.1:9000";
  const s3ConsolePort = Number(
    options.s3ConsolePort || process.env.SETUP_S3_CONSOLE_PORT || 9001
  );
  const s3Region = options.s3Region || "us-east-1";
  const s3AccessKey =
    options.s3AccessKey || process.env.SETUP_S3_ACCESS_KEY || "minioadmin";
  const s3SecretKey =
    options.s3SecretKey || process.env.SETUP_S3_SECRET_KEY || "minioadmin";
  const s3Bucket =
    options.s3Bucket || process.env.SETUP_S3_BUCKET || "patchwork";

  // 1. Provision DB & role
  const dbRes = await provisionDatabase({
    superuserUrl,
    host: dbHost,
    port: dbPort,
    dbName,
    dbUser,
    dbPassword,
    createTestDb,
  });

  // 2. Setup MinIO & verify read/write
  const minioRes = await setupMinioBucketAndVerify({
    projectDir,
    dataDir: minioDataDir,
    endpoint: s3Endpoint,
    consolePort: s3ConsolePort,
    region: s3Region,
    accessKeyId: s3AccessKey,
    secretAccessKey: s3SecretKey,
    bucket: s3Bucket,
  });

  // 3. Generate secrets & write .env (with backup if .env existed)
  const tokenEncryptionKey =
    options.tokenEncryptionKey || generateTokenEncryptionKeyHex();
  const envValues = buildFreshEnvValues({
    databaseUrl: dbRes.databaseUrl,
    appPort,
    appUrl,
    tokenEncryptionKey,
    s3Endpoint,
    s3Region,
    s3AccessKey,
    s3SecretKey,
    s3Bucket,
    minioPublicUrl: options.minioPublicUrl,
  });

  const envWriteRes = writeEnvFileAtomic(envPath, envValues, { backup: true });

  if (createTestDb && dbRes.testDatabaseUrl) {
    const envTestPath = options.envTestPath || path.join(projectDir, ".env.test");
    const testEnvValues = buildFreshEnvValues({
      databaseUrl: dbRes.testDatabaseUrl,
      appPort,
      appUrl,
      tokenEncryptionKey,
      s3Endpoint,
      s3Region,
      s3AccessKey,
      s3SecretKey,
      s3Bucket: `${s3Bucket}-test`,
      minioPublicUrl: options.minioPublicUrl,
    });
    writeEnvFileAtomic(envTestPath, testEnvValues, { backup: false });
    await runDatabaseMigrations(dbRes.testDatabaseUrl, drizzleDir);
  }

  // 4. Run migrations & verify schema
  const migrationStatus = await runDatabaseMigrations(
    dbRes.databaseUrl,
    drizzleDir
  );

  // 5. Generate & store encrypted Admin Setup Token
  const tokenRes = await createAndStoreAdminToken({
    databaseUrl: dbRes.databaseUrl,
    encryptionKey: tokenEncryptionKey,
    keyVersion: 1,
    confirmed: options.tokenConfirmed ?? true,
  });

  return {
    envPath,
    envValues,
    envBackupPath: envWriteRes.backupPath,
    databaseUrl: dbRes.databaseUrl,
    dbName,
    dbUser,
    minio: minioRes,
    migrationStatus,
    tokenBuffer: tokenRes.tokenBuffer,
    encryptedToken: tokenRes.encrypted,
    tokenEncryptionKey,
  };
}

export async function runReset(options = {}) {
  const projectDir = options.projectDir || process.cwd();
  const envPath = options.envPath || path.join(projectDir, ".env");
  const minioDataDir =
    options.minioDataDir || path.join(projectDir, ".minio-data");
  const backupsDir = options.backupsDir || path.join(projectDir, "backups");
  const superuserUrl =
    options.superuserUrl ||
    process.env.SETUP_PG_SUPERUSER_URL ||
    "postgres://postgres:postgres@localhost:5432/postgres";

  const envParsed = parseEnvFile(envPath);
  const existingDbUrl =
    options.databaseUrl ||
    envParsed.values.DATABASE_URL ||
    "postgres://patchwork:patchwork@localhost:5432/patchwork";

  const parsedDb = new URL(existingDbUrl);
  const targetDbName =
    options.dbName ||
    decodeURIComponent(parsedDb.pathname.replace(/^\//, "")) ||
    "patchwork";

  // Enforce typed confirmation of database name + second boolean confirmation
  if (options.typedConfirmation !== targetDbName) {
    throw new Error(
      `Reset aborted: typed confirmation '${options.typedConfirmation || ""}' does not match database name '${targetDbName}'`
    );
  }
  if (options.secondConfirmation !== true) {
    throw new Error("Reset aborted: second yes/no confirmation was not accepted");
  }

  // Optional backup before destructive reset
  const backupResult = await performBackup({
    databaseUrl: existingDbUrl,
    minioDataDir,
    backupsDir,
    backupDb: Boolean(options.backupDb),
    backupMinio: Boolean(options.backupMinio),
  });

  const envTestPath = options.envTestPath || path.join(projectDir, ".env.test");
  const wasDevMode = Boolean(
    options.devMode || options.createTestDb || fs.existsSync(envTestPath)
  );

  // Back up and remove .env (and .env.test only if created in dev mode)
  const envBackupPath = backupEnvFileIfExists(envPath);
  if (fs.existsSync(envPath)) {
    fs.unlinkSync(envPath);
  }
  if (wasDevMode && fs.existsSync(envTestPath)) {
    fs.unlinkSync(envTestPath);
  }

  const domainDocPath = path.join(projectDir, "DOMAIN_SETUP.md");
  if (fs.existsSync(domainDocPath)) {
    try {
      fs.unlinkSync(domainDocPath);
    } catch {}
  }

  const pidPath = path.join(projectDir, ".patchwork.pid");
  if (fs.existsSync(pidPath)) {
    try {
      fs.unlinkSync(pidPath);
    } catch {}
  }

  // Drop target database (and patchwork_test only if it was created in dev mode)
  const adminPool = new pg.Pool({
    connectionString: superuserUrl,
    connectionTimeoutMillis: 4000,
  });
  const adminClient = await adminPool.connect();
  try {
    await adminClient.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [targetDbName]
    );
    await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdent(targetDbName)}`);

    if (wasDevMode && targetDbName !== "patchwork_test") {
      await adminClient.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'patchwork_test' AND pid <> pg_backend_pid()`
      );
      await adminClient.query(`DROP DATABASE IF EXISTS "patchwork_test"`);
    }
  } finally {
    adminClient.release();
    await adminPool.end();
  }

  // Empty and remove MinIO bucket
  const s3Endpoint =
    options.s3Endpoint ||
    envParsed.values.S3_ENDPOINT ||
    "http://127.0.0.1:9000";
  const s3AccessKey =
    options.s3AccessKey || envParsed.values.S3_ACCESS_KEY || "minioadmin";
  const s3SecretKey =
    options.s3SecretKey || envParsed.values.S3_SECRET_KEY || "minioadmin";
  const s3Bucket =
    options.s3Bucket || envParsed.values.S3_BUCKET || "patchwork";

  await emptyAndRemoveMinioBucket({
    endpoint: s3Endpoint,
    accessKeyId: s3AccessKey,
    secretAccessKey: s3SecretKey,
    bucket: s3Bucket,
  });

  if (options.removeMinioDataDir && fs.existsSync(minioDataDir)) {
    try {
      fs.rmSync(minioDataDir, { recursive: true, force: true });
    } catch {
      // Ignore if MinIO daemon holds open lock on Windows
    }
  }

  if (options.reinstall === false) {
    return {
      resetCompleted: true,
      backupResult,
      envBackupPath,
      reinstalled: null,
    };
  }

  // Run Fresh Install Flow with a brand new token and brand new TOKEN_ENCRYPTION_KEY
  const freshInstall = await runFreshInstall({
    ...options,
    projectDir,
    envPath,
    envTestPath,
    createTestDb: wasDevMode,
    minioDataDir,
    superuserUrl,
    dbName: targetDbName,
    s3Endpoint,
    s3AccessKey,
    s3SecretKey,
    s3Bucket,
    tokenEncryptionKey: generateTokenEncryptionKeyHex(),
  });

  return {
    resetCompleted: true,
    backupResult,
    envBackupPath,
    reinstalled: freshInstall,
  };
}

