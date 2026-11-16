import fs from "fs";
import net from "net";
import path from "path";
import pg from "pg";
import {
  isWindows,
  binPath,
  getFreeDiskBytes,
  getMinioDownloadInfo,
} from "../lib/platform.mjs";

export function checkNodeVersion(minMajor = 20) {
  const version = process.versions.node;
  const major = Number(version.split(".")[0]);
  const passed = major >= minMajor;
  return {
    id: "node",
    label: `Node.js version (v${version}, minimum v${minMajor}.0.0)`,
    passed,
    detail: `Detected Node.js v${version}`,
    fixHint: passed
      ? ""
      : `Upgrade Node.js to v${minMajor}+ (https://nodejs.org/en/download)`,
  };
}

export async function checkPostgresReachable(connectionString) {
  const url =
    connectionString ||
    process.env.SETUP_PG_SUPERUSER_URL ||
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/postgres";

  const pool = new pg.Pool({
    connectionString: url,
    connectionTimeoutMillis: 3000,
  });
  try {
    const client = await pool.connect();
    try {
      const res = await client.query("SHOW server_version");
      const version = res.rows[0]?.server_version || "unknown";
      return {
        id: "postgres",
        label: "PostgreSQL server reachable",
        passed: true,
        detail: `Connected to PostgreSQL (${version})`,
        fixHint: "",
      };
    } finally {
      client.release();
    }
  } catch (err) {
    return {
      id: "postgres",
      label: "PostgreSQL server reachable",
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
      fixHint: isWindows
        ? "Start the PostgreSQL Windows service (`Start-Service postgresql*`) or verify credentials."
        : "Install and start PostgreSQL: `sudo apt install postgresql postgresql-contrib && sudo systemctl enable --now postgresql`",
    };
  } finally {
    await pool.end().catch(() => {});
  }
}

export function checkMinioBinary(projectDir = process.cwd()) {
  const info = binPath("minio", { projectDir });
  const passed = info.exists && info.executable;

  return {
    id: "minio-binary",
    label: `MinIO prebuilt binary (${path.relative(projectDir, info.expectedPath) || info.expectedPath})`,
    passed,
    binaryPath: info.path,
    detail: !info.exists
      ? `Missing official MinIO binary at ${info.expectedPath}`
      : !info.executable
        ? `MinIO binary at ${info.path} is not executable`
        : `Found at ${info.path}`,
    fixHint: passed ? "" : info.hint,
  };
}

export function isPortFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => {
      srv.close(() => resolve(true));
    });
    srv.listen(Number(port), host);
  });
}

async function isMinioAlreadyHealthy(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/minio/health/live`, {
      signal: AbortSignal.timeout(1200),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function checkPorts({
  appPort = 3000,
  minioApiPort = 9000,
  minioConsolePort = 9001,
  allowRunningMinio = true,
  allowRunningApp = false,
} = {}) {
  const appFree = await isPortFree(appPort);
  const minioApiFree = await isPortFree(minioApiPort);
  const minioConsoleFree = await isPortFree(minioConsolePort);

  const minioHealthy = !minioApiFree && (await isMinioAlreadyHealthy(minioApiPort));
  const minioOk = minioApiFree || (allowRunningMinio && minioHealthy);
  const consoleOk = minioConsoleFree || (allowRunningMinio && minioHealthy);
  const appOk = appFree || allowRunningApp;

  const busy = [];
  if (!appOk) busy.push(`App port ${appPort}`);
  if (!minioOk) busy.push(`MinIO API port ${minioApiPort}`);
  if (!consoleOk) busy.push(`MinIO Console port ${minioConsolePort}`);

  const passed = busy.length === 0;
  return {
    id: "ports",
    label: `Required ports available (app: ${appPort}, MinIO: ${minioApiPort}/${minioConsolePort})`,
    passed,
    detail: passed
      ? minioHealthy
        ? `Port ${appPort} free; MinIO already active on ${minioApiPort}`
        : `Ports ${appPort}, ${minioApiPort}, ${minioConsolePort} available`
      : `Ports in use: ${busy.join(", ")}`,
    fixHint: passed
      ? ""
      : `Stop processes listening on ${busy.join(", ")} or choose different ports.`,
  };
}

export function checkWriteAccess(projectDir = process.cwd(), dataDir) {
  const targetDataDir = dataDir || path.join(projectDir, ".minio-data");
  try {
    fs.mkdirSync(projectDir, { recursive: true });
    const probeProject = path.join(
      projectDir,
      `.write-probe-${process.pid}-${Date.now()}`
    );
    fs.writeFileSync(probeProject, "ok");
    fs.unlinkSync(probeProject);

    fs.mkdirSync(targetDataDir, { recursive: true });
    const probeData = path.join(
      targetDataDir,
      `.write-probe-${process.pid}-${Date.now()}`
    );
    fs.writeFileSync(probeData, "ok");
    fs.unlinkSync(probeData);

    return {
      id: "write-access",
      label: "Write access to project and data directories",
      passed: true,
      detail: `Writable: ${projectDir} & ${targetDataDir}`,
      fixHint: "",
    };
  } catch (err) {
    return {
      id: "write-access",
      label: "Write access to project and data directories",
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
      fixHint: `Grant write permissions to current user on ${projectDir} and ${targetDataDir}`,
    };
  }
}

export function checkDiskSpace(projectDir = process.cwd(), minBytes = 600 * 1024 * 1024) {
  const freeBytes = getFreeDiskBytes(projectDir);
  if (freeBytes === null) {
    return {
      id: "disk-space",
      label: "Free disk space (~600 MB recommended)",
      passed: true,
      detail: "Unable to query free disk space; continuing",
      fixHint: "",
    };
  }
  const freeMb = Math.round(freeBytes / (1024 * 1024));
  const minMb = Math.round(minBytes / (1024 * 1024));
  const passed = freeBytes >= minBytes;
  return {
    id: "disk-space",
    label: `Free disk space (minimum ${minMb} MB for PostgreSQL + MinIO + build)`,
    passed,
    detail: `${freeMb} MB free at ${projectDir}`,
    fixHint: passed ? "" : `Free at least ${minMb} MB of disk space in ${projectDir} before continuing.`,
  };
}

export async function checkDownloadNetwork(projectDir = process.cwd()) {
  const info = getMinioDownloadInfo();
  const cachedPath = path.join(projectDir, "data", "cache", info.assetName);
  const binInfo = binPath("minio", { projectDir });
  if ((binInfo.exists && binInfo.executable) || fs.existsSync(cachedPath)) {
    return {
      id: "network",
      label: "MinIO download availability",
      passed: true,
      detail: binInfo.exists
        ? `Local MinIO binary present at ${binInfo.path}`
        : `Cached MinIO binary present at ${cachedPath}`,
      fixHint: "",
    };
  }
  try {
    const res = await fetch(info.checksumUrl, {
      method: "GET",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return {
      id: "network",
      label: "Network access for MinIO binary download",
      passed: true,
      detail: `Reachable: ${info.checksumUrl}`,
      fixHint: "",
    };
  } catch (err) {
    return {
      id: "network",
      label: "Network access for MinIO binary download",
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
      fixHint: [
        `Offline/network error. Download manually and place in ${path.join(projectDir, "data", "cache")}:`,
        `  Binary:   ${info.downloadUrl}`,
        `  Checksum: ${info.checksumUrl}`,
      ].join("\n"),
    };
  }
}

export async function runEasyPreflightChecks(options = {}) {
  const projectDir = options.projectDir || process.cwd();
  const dataDir = options.dataDir || path.join(projectDir, "data");
  const checks = [
    checkNodeVersion(20),
    checkDiskSpace(projectDir, options.minDiskBytes || 600 * 1024 * 1024),
    await checkPorts({
      appPort: options.appPort || 3000,
      minioApiPort: options.minioApiPort || 19000,
      minioConsolePort: options.minioConsolePort || 19001,
      allowRunningMinio: options.allowRunningMinio ?? true,
      allowRunningApp: options.allowRunningApp ?? false,
    }),
    checkWriteAccess(projectDir, dataDir),
    await checkDownloadNetwork(projectDir),
  ];

  return {
    passed: checks.every((c) => c.passed),
    checks,
  };
}

export async function runPreflightChecks(options = {}) {
  const projectDir = options.projectDir || process.cwd();
  const dataDir = options.minioDataDir || path.join(projectDir, ".minio-data");
  const checks = [
    checkNodeVersion(20),
    await checkPostgresReachable(options.pgConnectionUrl),
    checkMinioBinary(projectDir),
    await checkPorts({
      appPort: options.appPort || 3000,
      minioApiPort: options.minioApiPort || 9000,
      minioConsolePort: options.minioConsolePort || 9001,
      allowRunningMinio: options.allowRunningMinio ?? true,
      allowRunningApp: options.allowRunningApp ?? false,
    }),
    checkWriteAccess(projectDir, dataDir),
  ];

  return {
    passed: checks.every((c) => c.passed),
    checks,
  };
}

