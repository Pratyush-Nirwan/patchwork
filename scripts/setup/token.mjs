import crypto from "crypto";
import pg from "pg";

export const SETUP_TOKEN_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export const SETUP_TOKEN_LENGTH = 32;

export const SETUP_TOKEN_WARNING =
  "Save this token now. It is required to register the admin account in browser setup step 1. It is never shown again and cannot be recovered. If you lose it, you must reset and reinstall.";

export function generateTokenEncryptionKeyHex() {
  return crypto.randomBytes(32).toString("hex");
}

export function parseEncryptionKeyBuffer(rawKey) {
  const keyStr = String(rawKey || "").trim();
  if (!keyStr) {
    throw new Error("Missing TOKEN_ENCRYPTION_KEY");
  }
  if (/^[0-9a-fA-F]{64}$/.test(keyStr)) {
    return Buffer.from(keyStr, "hex");
  }
  const b64 = Buffer.from(keyStr, "base64");
  if (
    b64.length === 32 &&
    b64.toString("base64").replace(/=+$/, "") === keyStr.replace(/=+$/, "")
  ) {
    return b64;
  }
  const utf8 = Buffer.from(keyStr, "utf8");
  if (utf8.length === 32) {
    return utf8;
  }
  throw new Error(
    "Invalid TOKEN_ENCRYPTION_KEY length: must be 32 bytes (64 hex chars)"
  );
}

export function generateAdminTokenBuffer() {
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

export function encryptAdminToken(tokenBufOrStr, rawKey, keyVersion = 1) {
  const key = parseEncryptionKeyBuffer(rawKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const inputBuf = Buffer.isBuffer(tokenBufOrStr)
    ? tokenBufOrStr
    : Buffer.from(String(tokenBufOrStr), "utf8");
  const encrypted = Buffer.concat([cipher.update(inputBuf), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyVersion,
  };
}

export function decryptAdminToken(record, rawKey) {
  if (!record || !record.ciphertext || !record.iv || !record.authTag) {
    throw new Error("Malformed setup_token encryption payload");
  }
  const key = parseEncryptionKeyBuffer(rawKey);
  const iv = Buffer.from(record.iv, "base64");
  const authTag = Buffer.from(record.authTag, "base64");
  const ciphertext = Buffer.from(record.ciphertext, "base64");

  if (iv.length !== 12 || authTag.length !== 16) {
    throw new Error("Invalid IV or authTag length in setup_token");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export async function createAndStoreAdminToken({
  databaseUrl,
  encryptionKey,
  keyVersion = 1,
  confirmed = false,
}) {
  const tokenBuf = generateAdminTokenBuffer();
  const encrypted = encryptAdminToken(tokenBuf, encryptionKey, keyVersion);

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "setup_token" (
        "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
        "ciphertext" text,
        "iv" text,
        "auth_tag" text,
        "key_version" integer DEFAULT 1 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "confirmed_at" timestamp with time zone,
        "consumed_at" timestamp with time zone
      );
    `);

    await client.query(
      `ALTER TABLE "setup_token" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;`
    );

    await client.query(
      `
      INSERT INTO "setup_token" (
        "id", "ciphertext", "iv", "auth_tag", "key_version", "created_at",
        "confirmed_at", "consumed_at"
      )
      VALUES ('default', $1, $2, $3, $4, now(), CASE WHEN $5 THEN now() ELSE NULL END, NULL)
      ON CONFLICT ("id") DO UPDATE SET
        "ciphertext" = EXCLUDED."ciphertext",
        "iv" = EXCLUDED."iv",
        "auth_tag" = EXCLUDED."auth_tag",
        "key_version" = EXCLUDED."key_version",
        "created_at" = now(),
        "confirmed_at" = CASE WHEN $5 THEN now() ELSE NULL END,
        "consumed_at" = NULL
      `,
      [
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        encrypted.keyVersion,
        Boolean(confirmed),
      ]
    );
  } finally {
    client.release();
    await pool.end();
  }

  return {
    tokenBuffer: tokenBuf,
    encrypted,
  };
}

export async function markAdminTokenConfirmed(databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE setup_token SET confirmed_at = now() WHERE id = 'default'`
    );
  } finally {
    client.release();
    await pool.end();
  }
}

export function formatTokenDisplayBox(tokenBuffer) {
  const border = "═".repeat(74);
  return [
    `╔${border}╗`,
    `║  ADMIN SETUP TOKEN (SINGLE-USE)                                          ║`,
    `╠${border}╣`,
    `║                                                                          ║`,
    `║    ${tokenBuffer.toString("utf8")}                                      ║`,
    `║                                                                          ║`,
    `╠${border}╣`,
    `║  ⚠ WARNING:                                                              ║`,
    `║  Save this token now. It is required to register the admin account in    ║`,
    `║  browser setup step 1. It is never shown again and cannot be recovered.  ║`,
    `║  If you lose it, you must reset and reinstall.                           ║`,
    `╚${border}╝`,
  ].join("\n");
}

/**
 * Simulates a terminal screen buffer that interprets cursor movement,
 * carriage return (\r), clear-to-end-of-screen (\x1b[J / \x1b[0J),
 * line erase (\x1b[K / \x1b[2K), and clear-scrollback (\x1b[3J).
 */
import {
  applyAnsiToScreenLines,
  createSharedInputSession,
  drainRawStreamBeforeSession,
  tokenizeInputChunk,
} from "./tty-session.mjs";
export {
  applyAnsiToScreenLines,
  createSharedInputSession,
  drainRawStreamBeforeSession,
  tokenizeInputChunk,
};

export async function displayAndConfirmAdminToken(options = {}) {
  const {
    tokenBuffer,
    databaseUrl,
    clearFallback = () => console.clear(),
  } = options;
  const inputStream = options.inputStream || process.stdin;
  const outputStream = options.outputStream || process.stdout;
  const isRealTty = Boolean(
    inputStream === process.stdin &&
      Boolean(inputStream?.isTTY) &&
      typeof inputStream.setRawMode === "function"
  );
  const isTTY =
    options.isTTY !== undefined
      ? Boolean(options.isTTY)
      : Boolean(
          isRealTty ||
            (inputStream !== process.stdin && !options.nonInteractive) ||
            process.env.SETUP_SIMULATE_TTY === "1"
        );
  const ansiSupported =
    options.ansiSupported !== undefined
      ? Boolean(options.ansiSupported)
      : Boolean(
          isTTY || outputStream?.isTTY || process.env.FORCE_ANSI === "1"
        );

  // If stdin is not a TTY (piped or --non-interactive), do not prompt:
  // print the token once to stdout and continue.
  if (!isTTY || options.nonInteractive) {
    const boxOutput = formatTokenDisplayBox(tokenBuffer);
    outputStream.write(`\n${boxOutput}\n`);
    tokenBuffer.fill(0);
    if (databaseUrl) {
      await markAdminTokenConfirmed(databaseUrl);
    }
    return { confirmed: true, prompted: false };
  }

  let printedLines = 0;

  const eraseTokenSection = () => {
    if (printedLines <= 0) return;
    if (isTTY || ansiSupported) {
      outputStream.write(`\x1b[${printedLines}A\r\x1b[0J\x1b[3J`);
    } else {
      clearFallback();
      outputStream.write(`\x1b[${printedLines}A\r\x1b[0J\x1b[3J`);
    }
    printedLines = 0;
  };

  const renderTokenSection = (retryWarning = false) => {
    const boxLines = formatTokenDisplayBox(tokenBuffer).split("\n");
    const sectionLines = [...boxLines];
    if (retryWarning) {
      sectionLines.push(
        "⚠ Invalid input. Please type 'saved' (exact word) once you have copied the token."
      );
    }
    const payload = `${sectionLines.join("\n")}\n`;
    outputStream.write(payload);
    printedLines = sectionLines.length;
  };

  // Drain any buffered stdin before showing the token confirmation prompt
  const ownsSession = !options.inputSession;
  let preSeededTokens = [];
  if (ownsSession && !isRealTty) {
    preSeededTokens = drainRawStreamBeforeSession(inputStream);
  }
  const session = options.inputSession || createSharedInputSession(inputStream);
  if (!ownsSession) {
    session.drainBufferedStdin();
  } else if (preSeededTokens.length > 0) {
    session.tokenQueue.unshift(...preSeededTokens);
  }

  const onSigIntErase = () => {
    eraseTokenSection();
    tokenBuffer.fill(0);
  };
  process.once("SIGINT", onSigIntErase);

  const delayMs =
    options.postDisplayDelayMs !== undefined
      ? Number(options.postDisplayDelayMs)
      : 100;

  try {
    renderTokenSection(false);

    // 100 ms delay after the token box is printed before reading input
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (isRealTty) {
      session.drainBufferedStdin();
    }

    let confirmed = false;

    while (true) {
      const promptRes = await session.promptRawText({
        message:
          "Type 'saved' to confirm you have saved the Admin Setup Token:",
        outputStream,
      });

      if (promptRes.caughtCtrlC) {
        printedLines += promptRes.promptLines;
        eraseTokenSection();
        tokenBuffer.fill(0);
        throw new Error(
          "Interrupted (Ctrl+C) before confirming Admin Setup Token."
        );
      }

      if (promptRes.abortedOnEof || promptRes.isCancel) {
        printedLines += promptRes.promptLines;
        break;
      }

      const rawVal = String(promptRes.value ?? "");
      const trimmed = rawVal.trim();

      // Ignore empty input (a bare Enter) silently: do not validate it,
      // do not print an error, and re-wait for input.
      if (trimmed === "") {
        if (promptRes.promptLines > 0 && ansiSupported) {
          outputStream.write(`\x1b[${promptRes.promptLines}A\r\x1b[0J`);
        }
        continue;
      }

      printedLines += promptRes.promptLines;

      // Accept `saved` case-insensitively with surrounding whitespace trimmed.
      if (trimmed.toLowerCase() === "saved") {
        tokenBuffer.fill(0);
        eraseTokenSection();
        outputStream.write("✔ Admin token saved.\n");
        if (databaseUrl) {
          await markAdminTokenConfirmed(databaseUrl);
        }
        confirmed = true;
        break;
      }

      // Print "Invalid input" only after the user has typed a non-empty value that is not `saved`.
      eraseTokenSection();
      renderTokenSection(true);
    }

    if (!confirmed) {
      // Closed terminal / stdin 'end' before typing 'saved' -> erase section, zero buffer, exit cleanly
      eraseTokenSection();
      tokenBuffer.fill(0);
      throw new Error(
        "Terminal closed before Admin Setup Token was confirmed as saved."
      );
    }

    return { confirmed: true, prompted: true };
  } finally {
    tokenBuffer.fill(0);
    process.removeListener("SIGINT", onSigIntErase);
    if (ownsSession) {
      session.close();
    }
  }
}
