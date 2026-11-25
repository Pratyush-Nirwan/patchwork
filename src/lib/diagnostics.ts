import fs from "fs";
import { version as pkgAppVersion, channel as pkgChannel } from "@/lib/version";
import path from "path";
import { pool } from "@/db";
import { realtimeHub } from "./realtime";
import { getS3Bucket, getS3Client } from "./attachments";
import { getPlatformInfo } from "./platform";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { getWorkerHealthSnapshot, type WorkerHealthSnapshot } from "./worker";

export interface LoggedServerError {
  timestamp: string;
  message: string;
  stack?: string;
  path?: string;
  status?: number;
}

const MAX_ERROR_LOGS = 50;
const errorRingBuffer: LoggedServerError[] = [];

export function redactSecrets(text: string): string {
  if (!text) return "";
  return text
    // Redact connection strings (postgres://user:pass@host)
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/gi, "$1***$3")
    // Redact Authorization headers or tokens
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]")
    .replace(/(token|password|secret|key|cookie)=([^&;\s]+)/gi, "$1=[REDACTED]")
    // Redact JSON fields
    .replace(/"(password|passwordHash|token|secret|secretKey|accessKey|authTag|ciphertext|csrfToken)"\s*:\s*"[^"]*"/gi, '"$1": "[REDACTED]"')
    // Redact minio / AWS credentials
    .replace(/(minioadmin|minioadmin123)/gi, "[REDACTED]");
}

export function recordServerError(err: unknown, requestPath?: string): void {
  try {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const rawStack = err instanceof Error ? err.stack : undefined;
    const sanitizedMsg = redactSecrets(rawMsg);
    const sanitizedStack = rawStack ? redactSecrets(rawStack) : undefined;

    const entry: LoggedServerError = {
      timestamp: new Date().toISOString(),
      message: sanitizedMsg,
      stack: sanitizedStack,
      path: requestPath ? redactSecrets(requestPath) : undefined,
    };

    errorRingBuffer.push(entry);
    if (errorRingBuffer.length > MAX_ERROR_LOGS) {
      errorRingBuffer.shift();
    }
  } catch {
    // Keep logger non-throwing
  }
}

export function getRecentServerErrors(): LoggedServerError[] {
  return [...errorRingBuffer].reverse();
}

export interface DiagnosticsBundle {
  appVersion: string;
  channel: string;
  nodeVersion: string;
  platform: string;
  serverUptimeSec: number;
  sseConnectionCount: number;
  database: {
    status: "healthy" | "unhealthy";
    latencyMs: number;
    appliedMigrations: number;
    pendingMigrations: number;
  };
  minio: {
    status: "healthy" | "unhealthy";
    bucket: string;
    latencyMs: number;
  };
  worker: WorkerHealthSnapshot;
  recentErrors: LoggedServerError[];
  generatedAt: string;
}

export async function generateDiagnosticsBundle(): Promise<DiagnosticsBundle> {
  const appVersion = pkgAppVersion;

  // Database check
  let dbStatus: "healthy" | "unhealthy" = "healthy";
  let dbLatencyMs = -1;
  try {
    const start = Date.now();
    await pool.query("SELECT 1");
    dbLatencyMs = Date.now() - start;
  } catch {
    dbStatus = "unhealthy";
  }

  // Migration status
  let totalMigrations = 0;
  try {
    const journalPath = path.join(process.cwd(), "drizzle", "meta", "_journal.json");
    if (fs.existsSync(journalPath)) {
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
      totalMigrations = Array.isArray(journal.entries) ? journal.entries.length : 0;
    }
  } catch {
    // ignore
  }

  // MinIO check
  let minioStatus: "healthy" | "unhealthy" = "healthy";
  let minioLatencyMs = -1;
  const bucketName = getS3Bucket();
  try {
    const s3 = getS3Client();
    const start = Date.now();
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
    minioLatencyMs = Date.now() - start;
  } catch {
    minioStatus = "unhealthy";
  }

  const worker = await getWorkerHealthSnapshot();

  return {
    appVersion,
    channel: pkgChannel,
    nodeVersion: process.version,
    platform: getPlatformInfo().platform,
    serverUptimeSec: Math.floor(process.uptime()),
    sseConnectionCount: realtimeHub.getListenerCount(),
    database: {
      status: dbStatus,
      latencyMs: dbLatencyMs,
      appliedMigrations: totalMigrations,
      pendingMigrations: 0,
    },
    minio: {
      status: minioStatus,
      bucket: bucketName,
      latencyMs: minioLatencyMs,
    },
    worker,
    recentErrors: getRecentServerErrors(),
    generatedAt: new Date().toISOString(),
  };
}

