import crypto from "crypto";
import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import {
  getMinioDownloadInfo,
  isWindows,
  makeExecutable,
} from "../lib/platform.mjs";

const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 120000;

export function parseSha256Sum(text) {
  const match = String(text || "").trim().match(/^([0-9a-fA-F]{64})\b/m);
  if (!match) {
    throw new Error("Invalid SHA-256 checksum format");
  }
  return match[1].toLowerCase();
}

export async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex").toLowerCase()));
  });
}

function isHostInNoProxy(hostname, noProxyValue) {
  if (!noProxyValue) return false;
  const host = hostname.toLowerCase();
  for (const rawEntry of String(noProxyValue).split(",")) {
    const entry = rawEntry.trim().toLowerCase();
    if (!entry) continue;
    if (entry === "*") return true;
    const clean = entry.replace(/^\./, "");
    if (host === clean || host.endsWith(`.${clean}`)) return true;
  }
  return false;
}

/**
 * @param {string} targetUrl
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveProxyForUrl(targetUrl, env = process.env) {
  const parsed = new URL(targetUrl);
  const noProxy = env.NO_PROXY || env.no_proxy || "";
  if (isHostInNoProxy(parsed.hostname, noProxy)) {
    return null;
  }
  if (parsed.protocol === "https:") {
    return env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || null;
  }
  return env.HTTP_PROXY || env.http_proxy || null;
}

function openHttpTunnel(proxyUrl, targetHost, targetPort, timeoutMs) {
  const proxy = new URL(proxyUrl);
  const client = proxy.protocol === "https:" ? https : http;
  const proxyPort = Number(proxy.port || (proxy.protocol === "https:" ? 443 : 80));
  const authHeader =
    proxy.username || proxy.password
      ? `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`
      : null;

  return new Promise((resolve, reject) => {
    const req = client.request({
      host: proxy.hostname,
      port: proxyPort,
      method: "CONNECT",
      path: `${targetHost}:${targetPort}`,
      headers: {
        Host: `${targetHost}:${targetPort}`,
        ...(authHeader ? { "Proxy-Authorization": authHeader } : {}),
      },
      timeout: timeoutMs,
    });
    req.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`Proxy CONNECT failed with HTTP ${res.statusCode}`));
        return;
      }
      resolve(socket);
    });
    req.on("timeout", () => req.destroy(new Error("Proxy connection timed out")));
    req.on("error", reject);
    req.end();
  });
}

async function requestStream(targetUrl, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, env = process.env, allowInsecureLocalhost = true } = {}, redirects = 0) {
  if (redirects > 5) {
    throw new Error(`Too many redirects while fetching ${targetUrl}`);
  }
  const parsed = new URL(targetUrl);
  const isLocal = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(allowInsecureLocalhost && isLocal)) {
    throw new Error(`Refusing non-HTTPS download URL: ${targetUrl}`);
  }

  const proxyUrl = resolveProxyForUrl(targetUrl, env);
  let agent = undefined;
  let socketToCleanup = null;
  if (proxyUrl && parsed.protocol === "https:") {
    const socket = await openHttpTunnel(proxyUrl, parsed.hostname, Number(parsed.port || 443), timeoutMs);
    socketToCleanup = socket;
    agent = new https.Agent({ keepAlive: false });
    agent.createConnection = () => socket;
  }

  const mod = parsed.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      targetUrl,
      {
        method: "GET",
        headers: {
          "User-Agent": "patchwork-installer",
          ...headers,
        },
        timeout: timeoutMs,
        ...(agent ? { agent } : {}),
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          const nextUrl = new URL(res.headers.location, targetUrl).toString();
          resolve(requestStream(nextUrl, { headers, timeoutMs, env, allowInsecureLocalhost }, redirects + 1));
          return;
        }
        resolve(res);
      }
    );
    req.on("timeout", () => req.destroy(new Error(`Request timed out for ${targetUrl}`)));
    req.on("error", (err) => {
      if (socketToCleanup && !socketToCleanup.destroyed) socketToCleanup.destroy();
      reject(err);
    });
    req.end();
  });
}

export async function fetchTextWithRetry(url, options = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await requestStream(url, options);
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        throw new Error(`HTTP ${res.statusCode} fetching ${url}`);
      }
      const chunks = [];
      for await (const chunk of res) chunks.push(chunk);
      return Buffer.concat(chunks).toString("utf8");
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, attempt * 750));
      }
    }
  }
  throw lastErr;
}

/**
 * @param {{
 *   url: string,
 *   expectedSha256: string,
 *   destPath: string,
 *   expectedBytes?: number | null,
 *   onProgress?: ((progress: { downloaded: number, total: number | null }) => void) | undefined,
 *   env?: Record<string, string | undefined>,
 *   timeoutMs?: number,
 * }} options
 */
export async function downloadVerifiedFile({
  url,
  expectedSha256,
  destPath,
  expectedBytes = null,
  onProgress,
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });
  const partPath = `${destPath}.part`;

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const existingBytes = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
      const headers = existingBytes > 0 ? { Range: `bytes=${existingBytes}-` } : {};
      const res = await requestStream(url, { headers, timeoutMs, env });

      if (res.statusCode === 416) {
        res.resume();
        fs.rmSync(partPath, { force: true });
        continue;
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        throw new Error(`HTTP ${res.statusCode} downloading ${url}`);
      }

      const appendMode = res.statusCode === 206 && existingBytes > 0;
      if (!appendMode && existingBytes > 0) {
        fs.rmSync(partPath, { force: true });
      }

      const contentLenHeader = Number(res.headers["content-length"] || 0);
      const totalExpected = appendMode
        ? existingBytes + contentLenHeader
        : contentLenHeader || expectedBytes || 0;

      let received = appendMode ? existingBytes : 0;
      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(partPath, { flags: appendMode ? "a" : "w" });
        res.on("data", (chunk) => {
          received += chunk.length;
          if (typeof onProgress === "function") {
            onProgress({ received, total: totalExpected });
          }
        });
        res.on("error", (err) => {
          ws.destroy();
          reject(err);
        });
        ws.on("error", reject);
        ws.on("finish", resolve);
        res.pipe(ws);
      });

      const actualSize = fs.statSync(partPath).size;
      if (totalExpected > 0 && actualSize !== totalExpected) {
        fs.rmSync(partPath, { force: true });
        throw new Error(`Truncated download: expected ${totalExpected} bytes, got ${actualSize}`);
      }
      if (expectedBytes && actualSize !== expectedBytes) {
        fs.rmSync(partPath, { force: true });
        throw new Error(`Unexpected file size: expected ${expectedBytes} bytes, got ${actualSize}`);
      }

      const actualSha = await sha256File(partPath);
      if (actualSha !== expectedSha256.toLowerCase()) {
        fs.rmSync(partPath, { force: true });
        throw new Error(
          `SHA-256 mismatch for ${path.basename(destPath)}: expected ${expectedSha256}, got ${actualSha}`
        );
      }

      fs.renameSync(partPath, destPath);
      return { path: destPath, sha256: actualSha, bytes: actualSize };
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }
  }

  fs.rmSync(partPath, { force: true });
  throw lastErr;
}

function formatWindowsAntivirusHint(filePath, err) {
  const code = err?.code || "";
  if (isWindows && (code === "EACCES" || code === "EPERM" || code === "EBUSY")) {
    return new Error(
      `Windows blocked access to ${filePath} (${code}). Add an exclusion for ./bin and ./data in Windows Security (Virus & threat protection -> Exclusions) or close any running minio.exe process, then re-run setup.`
    );
  }
  return err;
}

/**
 * @param {{
 *   projectDir?: string,
 *   yes?: boolean,
 *   confirmDownload?: ((info: Record<string, unknown>) => Promise<boolean>) | undefined,
 *   onProgress?: ((progress: { downloaded: number, total: number | null }) => void) | undefined,
 *   env?: Record<string, string | undefined>,
 *   downloadInfoOverride?: {
 *     releaseTag?: string,
 *     assetName: string,
 *     downloadUrl: string,
 *     checksumUrl: string,
 *     expectedBytes?: number | null,
 *   } | null,
 * }} [options]
 */
export async function ensureMinioBinary({
  projectDir = process.cwd(),
  yes = false,
  confirmDownload,
  onProgress,
  env = process.env,
  downloadInfoOverride = null,
} = {}) {
  const info = downloadInfoOverride || getMinioDownloadInfo();
  const binDir = path.join(projectDir, "bin");
  const cacheDir = path.join(projectDir, "data", "cache");
  const binFileName = isWindows ? "minio.exe" : "minio";
  const targetBinPath = path.join(binDir, binFileName);
  const cachedBinPath = path.join(cacheDir, info.assetName);
  const cachedSumPath = `${cachedBinPath}.sha256sum`;

  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  // 1. Obtain expected SHA-256 (prefer live HTTPS .sha256sum; fall back to cached .sha256sum only if offline)
  let expectedSha = null;
  let networkError = null;
  try {
    const sumText = await fetchTextWithRetry(info.checksumUrl, { env });
    expectedSha = parseSha256Sum(sumText);
    fs.writeFileSync(cachedSumPath, `${expectedSha}  ${info.assetName}\n`, "utf8");
  } catch (err) {
    networkError = err;
    if (fs.existsSync(cachedSumPath)) {
      expectedSha = parseSha256Sum(fs.readFileSync(cachedSumPath, "utf8"));
    }
  }

  // 2. Check existing ./bin/minio[.exe]
  if (fs.existsSync(targetBinPath) && expectedSha) {
    try {
      const binSha = await sha256File(targetBinPath);
      if (binSha === expectedSha) {
        makeExecutable(targetBinPath);
        return {
          path: targetBinPath,
          sha256: binSha,
          verified: true,
          source: "bin",
          downloaded: false,
          info,
        };
      }
    } catch (err) {
      throw formatWindowsAntivirusHint(targetBinPath, err);
    }
  }

  // 3. Check ./data/cache/<assetName>
  if (fs.existsSync(cachedBinPath) && expectedSha) {
    const cacheSha = await sha256File(cachedBinPath);
    if (cacheSha === expectedSha) {
      try {
        fs.copyFileSync(cachedBinPath, targetBinPath);
        makeExecutable(targetBinPath);
        const copiedSha = await sha256File(targetBinPath);
        if (copiedSha !== expectedSha) {
          fs.rmSync(targetBinPath, { force: true });
          throw new Error("Copied MinIO binary failed SHA-256 verification");
        }
        return {
          path: targetBinPath,
          sha256: copiedSha,
          verified: true,
          source: "cache",
          downloaded: false,
          info,
        };
      } catch (err) {
        throw formatWindowsAntivirusHint(targetBinPath, err);
      }
    }
    // Corrupt cache entry: delete before re-downloading
    fs.rmSync(cachedBinPath, { force: true });
  }

  // 4. Offline / unreachable without valid cache
  if (!expectedSha || networkError) {
    const reason = networkError ? networkError.message : "Network unavailable";
    throw new Error(
      [
        `Unable to fetch MinIO checksum/binary (${reason}).`,
        `Offline manual route:`,
        `  1. Download: ${info.downloadUrl}`,
        `  2. Verify SHA-256 against: ${info.checksumUrl}`,
        `  3. Place both files in: ${cacheDir}`,
        `     - ${cachedBinPath}`,
        `     - ${cachedSumPath}`,
        `  4. Re-run: npm run setup`,
      ].join("\n")
    );
  }

  // 5. Confirm download with user (name, size, URL)
  if (!yes && typeof confirmDownload === "function") {
    const sizeMb = info.expectedBytes
      ? `${(info.expectedBytes / (1024 * 1024)).toFixed(1)} MB`
      : "approx. 105 MB";
    const approved = await confirmDownload({
      name: info.assetName,
      sizeLabel: sizeMb,
      url: info.downloadUrl,
      checksumUrl: info.checksumUrl,
    });
    if (!approved) {
      throw new Error("MinIO binary download cancelled by user.");
    }
  }

  // 6. Download to cache, verify SHA-256, copy to ./bin/
  try {
    const res = await downloadVerifiedFile({
      url: info.downloadUrl,
      expectedSha256: expectedSha,
      destPath: cachedBinPath,
      expectedBytes: info.expectedBytes,
      onProgress,
      env,
    });
    fs.copyFileSync(cachedBinPath, targetBinPath);
    makeExecutable(targetBinPath);
    const binSha = await sha256File(targetBinPath);
    if (binSha !== expectedSha) {
      fs.rmSync(targetBinPath, { force: true });
      throw new Error("Installed MinIO binary failed SHA-256 verification");
    }
    return {
      path: targetBinPath,
      sha256: res.sha256,
      verified: true,
      source: "download",
      downloaded: true,
      info,
    };
  } catch (err) {
    throw formatWindowsAntivirusHint(targetBinPath, err);
  }
}
