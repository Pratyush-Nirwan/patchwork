import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { setupToken } from "@/db/schema";
import { AppError } from "./errors";
import { ValidationError } from "./setup";

export const SETUP_TOKEN_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export const SETUP_TOKEN_LENGTH = 32;

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_FAILURES = 5;

const failedAttemptsByIp = new Map<string, number[]>();

export function parseEncryptionKey(rawKey?: string): Buffer {
  const keyStr = (rawKey ?? process.env.TOKEN_ENCRYPTION_KEY ?? "").trim();
  if (!keyStr) {
    throw new Error("Missing TOKEN_ENCRYPTION_KEY");
  }
  if (/^[0-9a-fA-F]{64}$/.test(keyStr)) {
    return Buffer.from(keyStr, "hex");
  }
  const b64 = Buffer.from(keyStr, "base64");
  if (b64.length === 32 && b64.toString("base64").replace(/=+$/, "") === keyStr.replace(/=+$/, "")) {
    return b64;
  }
  const utf8 = Buffer.from(keyStr, "utf8");
  if (utf8.length === 32) {
    return utf8;
  }
  throw new Error("Invalid TOKEN_ENCRYPTION_KEY length: must be 32 bytes (64 hex chars)");
}

export function generateSetupTokenBuffer(): Buffer {
  const out = Buffer.alloc(SETUP_TOKEN_LENGTH);
  const alphabetLen = SETUP_TOKEN_ALPHABET.length; // 57
  const maxUnbiased = 256 - (256 % alphabetLen); // 228
  let idx = 0;

  while (idx < SETUP_TOKEN_LENGTH) {
    const rand = crypto.randomBytes(64);
    for (let i = 0; i < rand.length && idx < SETUP_TOKEN_LENGTH; i++) {
      const byte = rand[i];
      if (byte < maxUnbiased) {
        out[idx++] = SETUP_TOKEN_ALPHABET.charCodeAt(byte % alphabetLen);
      }
    }
    rand.fill(0);
  }
  return out;
}

export function generateSetupTokenString(): string {
  const buf = generateSetupTokenBuffer();
  try {
    return buf.toString("utf8");
  } finally {
    buf.fill(0);
  }
}

export function encryptSetupToken(
  plaintext: string | Buffer,
  rawKey?: string,
  keyVersion = 1
): {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
} {
  const key = parseEncryptionKey(rawKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: 16,
  });
  const inputBuf =
    typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
  try {
    const encrypted = Buffer.concat([cipher.update(inputBuf), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      keyVersion,
    };
  } finally {
    key.fill(0);
    if (typeof plaintext === "string") {
      inputBuf.fill(0);
    }
  }
}

export function decryptSetupToken(
  record: {
    ciphertext: string | null;
    iv: string | null;
    authTag: string | null;
  },
  rawKey?: string
): string {
  if (!record.ciphertext || !record.iv || !record.authTag) {
    throw new Error("Setup token ciphertext is missing or already consumed");
  }
  const key = parseEncryptionKey(rawKey);
  try {
    const iv = Buffer.from(record.iv, "base64");
    const authTag = Buffer.from(record.authTag, "base64");
    const ciphertext = Buffer.from(record.ciphertext, "base64");

    if (iv.length !== 12) {
      throw new Error("Invalid IV length");
    }
    if (authTag.length !== 16) {
      throw new Error("Invalid auth tag length");
    }
    if (ciphertext.length === 0) {
      throw new Error("Empty ciphertext");
    }

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, {
      authTagLength: 16,
    });
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    try {
      return decrypted.toString("utf8");
    } finally {
      decrypted.fill(0);
    }
  } finally {
    key.fill(0);
  }
}

export function compareSetupTokenConstantTime(
  submitted: string,
  expected: string
): boolean {
  const a = Buffer.from(submitted, "utf8");
  const b = Buffer.from(expected, "utf8");
  try {
    if (a.length !== b.length || b.length === 0) {
      const dummy = Buffer.alloc(Math.max(1, b.length));
      crypto.timingSafeEqual(dummy, dummy);
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  } finally {
    a.fill(0);
    b.fill(0);
  }
}

export function checkSetupTokenRateLimit(ip: string): void {
  const key = ip || "127.0.0.1";
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const recent = (failedAttemptsByIp.get(key) || []).filter((t) => t > cutoff);
  if (recent.length > 0) {
    failedAttemptsByIp.set(key, recent);
  } else {
    failedAttemptsByIp.delete(key);
  }
  if (recent.length >= RATE_LIMIT_MAX_FAILURES) {
    throw new AppError(
      "Setup step 1 failed. Please verify your setup token and try again later.",
      429,
      "RATE_LIMITED"
    );
  }
}

export function recordFailedSetupTokenAttempt(ip: string): void {
  const key = ip || "127.0.0.1";
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const recent = (failedAttemptsByIp.get(key) || []).filter((t) => t > cutoff);
  recent.push(now);
  failedAttemptsByIp.set(key, recent);
}

export function clearSetupTokenRateLimits(): void {
  failedAttemptsByIp.clear();
}

export async function provisionSetupTokenInDb(rawKey?: string): Promise<string> {
  const tokenBuf = generateSetupTokenBuffer();
  try {
    const tokenPlain = tokenBuf.toString("utf8");
    const encrypted = encryptSetupToken(tokenBuf, rawKey, 1);
    const now = new Date();
    await db
      .insert(setupToken)
      .values({
        id: "default",
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
        createdAt: now,
        confirmedAt: now,
        consumedAt: null,
      })
      .onConflictDoUpdate({
        target: setupToken.id,
        set: {
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyVersion: encrypted.keyVersion,
          createdAt: now,
          confirmedAt: now,
          consumedAt: null,
        },
      });
    return tokenPlain;
  } finally {
    tokenBuf.fill(0);
  }
}

export async function verifySubmittedSetupToken(
  submittedToken: string | undefined | null,
  clientIp = "127.0.0.1",
  rawKey?: string
): Promise<void> {
  checkSetupTokenRateLimit(clientIp);

  const genericFailure = () => {
    recordFailedSetupTokenAttempt(clientIp);
    throw new ValidationError("Setup step 1 verification failed", {
      setupToken: "Invalid or unavailable setup token",
    });
  };

  const trimmed = (submittedToken || "").trim();
  if (!trimmed) {
    genericFailure();
  }

  const [row] = await db
    .select()
    .from(setupToken)
    .where(eq(setupToken.id, "default"))
    .limit(1);

  if (
    !row ||
    row.consumedAt !== null ||
    row.confirmedAt === null ||
    !row.ciphertext ||
    !row.iv ||
    !row.authTag
  ) {
    genericFailure();
  }

  let expectedPlain = "";
  try {
    expectedPlain = decryptSetupToken(row!, rawKey);
  } catch {
    genericFailure();
  }

  const matches = compareSetupTokenConstantTime(trimmed, expectedPlain);
  if (!matches) {
    genericFailure();
  }
}

export async function consumeSetupToken(): Promise<void> {
  await db
    .update(setupToken)
    .set({
      consumedAt: new Date(),
      ciphertext: null,
      iv: null,
      authTag: null,
    })
    .where(eq(setupToken.id, "default"));
}

