import crypto from "crypto";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { generateTokenEncryptionKeyHex } from "./token.mjs";
import { setSecureFileMode } from "../lib/platform.mjs";

export const REQUIRED_ENV_KEYS = [
  "DATABASE_URL",
  "PORT",
  "APP_URL",
  "SESSION_SECRET",
  "CSRF_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "S3_BUCKET",
];

const SECRET_KEYS = new Set([
  "SESSION_SECRET",
  "CSRF_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "S3_SECRET_KEY",
  "GITHUB_TOKEN",
  "GITLAB_TOKEN",
]);

export function generateRandomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function generateStrongPassword(length = 24) {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const rand = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[rand[i] % alphabet.length];
  }
  return out;
}

export function parseEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return { exists: false, values: {}, raw: "" };
  }
  const raw = fs.readFileSync(envPath, "utf8");
  const values = dotenv.parse(raw);
  return { exists: true, values, raw };
}

export function validateEnvValues(values) {
  const missing = [];
  for (const key of REQUIRED_ENV_KEYS) {
    if (!values[key] || String(values[key]).trim() === "") {
      missing.push(key);
    }
  }
  let validEncryptionKey = false;
  if (values.TOKEN_ENCRYPTION_KEY) {
    const k = String(values.TOKEN_ENCRYPTION_KEY).trim();
    validEncryptionKey =
      /^[0-9a-fA-F]{64}$/.test(k) || Buffer.from(k, "utf8").length === 32;
  }
  return {
    valid: missing.length === 0 && validEncryptionKey,
    missing,
    validEncryptionKey,
  };
}

export function backupEnvFileIfExists(envPath, timestamp = Date.now()) {
  if (!fs.existsSync(envPath)) {
    return null;
  }
  const backupPath = `${envPath}.bak.${timestamp}`;
  fs.copyFileSync(envPath, backupPath);
  setSecureFileMode(backupPath);
  return backupPath;
}

export function detectInstallMode(projectDir = process.cwd(), values = {}) {
  const explicit = String(values.PATCHWORK_INSTALL_MODE || "").trim().toLowerCase();
  if (explicit === "easy" || explicit === "advanced") return explicit;
  if (fs.existsSync(path.join(projectDir, "data", "postgres", "PG_VERSION"))) {
    return "easy";
  }
  return "advanced";
}

export function formatEnvContent(values) {
  const orderedKeys = [
    "PATCHWORK_INSTALL_MODE",
    "DATABASE_URL",
    "PORT",
    "APP_URL",
    "SESSION_SECRET",
    "CSRF_SECRET",
    "TOKEN_ENCRYPTION_KEY",
    "S3_ENDPOINT",
    "S3_REGION",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "S3_BUCKET",
    "MAX_ATTACHMENT_BYTES",
    "MINIO_PUBLIC_URL",
    "MINIO_CONSOLE_PORT",
    "MINIO_BIND_HOST",
    "GITHUB_TOKEN",
    "GITLAB_TOKEN",
  ];

  const lines = [];
  const seen = new Set();

  for (const key of orderedKeys) {
    if (values[key] !== undefined) {
      lines.push(`${key}=${values[key]}`);
      seen.add(key);
    }
  }

  for (const [k, v] of Object.entries(values)) {
    if (!seen.has(k) && v !== undefined) {
      lines.push(`${k}=${v}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function writeEnvFileAtomic(
  envPath,
  values,
  { backup = true, timestamp = Date.now() } = {}
) {
  const dir = path.dirname(envPath);
  fs.mkdirSync(dir, { recursive: true });

  const content = formatEnvContent(values).replace(/\r\n/g, "\n");
  if (fs.existsSync(envPath)) {
    const current = fs.readFileSync(envPath, "utf8");
    if (current === content) {
      const permission = setSecureFileMode(envPath);
      return { changed: false, backupPath: null, permission };
    }
  }

  const backupPath = backup ? backupEnvFileIfExists(envPath, timestamp) : null;
  const tmpPath = `${envPath}.tmp.${process.pid}.${Date.now()}`;

  try {
    fs.writeFileSync(tmpPath, content, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmpPath, envPath);
    const permission = setSecureFileMode(envPath);
    return { changed: true, backupPath, permission };
  } finally {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup error
      }
    }
  }
}

export function buildFreshEnvValues(options = {}) {
  const appPort = String(options.appPort || 3000);
  const appUrl = options.appUrl || `http://localhost:${appPort}`;
  return {
    DATABASE_URL:
      options.databaseUrl ||
      "postgres://patchwork:patchwork@localhost:5432/patchwork",
    PORT: appPort,
    APP_URL: appUrl,
    SESSION_SECRET: options.sessionSecret || generateRandomSecret(32),
    CSRF_SECRET: options.csrfSecret || generateRandomSecret(32),
    TOKEN_ENCRYPTION_KEY:
      options.tokenEncryptionKey || generateTokenEncryptionKeyHex(),
    S3_ENDPOINT: options.s3Endpoint || "http://127.0.0.1:9000",
    S3_REGION: options.s3Region || "us-east-1",
    S3_ACCESS_KEY: options.s3AccessKey || "minioadmin",
    S3_SECRET_KEY: options.s3SecretKey || generateStrongPassword(24),
    S3_BUCKET: options.s3Bucket || "patchwork",
    MAX_ATTACHMENT_BYTES: String(options.maxAttachmentBytes || 10485760),
    ...(options.minioPublicUrl
      ? { MINIO_PUBLIC_URL: options.minioPublicUrl }
      : {}),
    ...(options.extraValues || {}),
  };
}

export function redactSecretsInText(text, extraSecrets = []) {
  let out = String(text || "");
  out = out.replace(
    /(postgres(?:ql)?:\/\/[^:\s]+:)([^@\s]+)(@)/gi,
    "$1[REDACTED]$3"
  );
  for (const key of SECRET_KEYS) {
    const regex = new RegExp(`(${key}=)([^\\s\\r\\n]+)`, "g");
    out = out.replace(regex, "$1[REDACTED]");
  }
  for (const secret of extraSecrets) {
    if (secret && String(secret).length >= 6) {
      out = out.split(String(secret)).join("[REDACTED]");
    }
  }
  return out;
}

