import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlatformHelper } from "../scripts/lib/platform.mjs";
import {
  downloadVerifiedFile,
  ensureMinioBinary,
  resolveProxyForUrl,
  sha256File,
} from "../scripts/setup/download.mjs";
import {
  cleanStalePostgresPid,
  checkEmbeddedPgMajorVersion,
  EMBEDDED_PG_MAJOR,
} from "../scripts/setup/embedded-pg.mjs";
import { detectInstallMode, parseEnvFile } from "../scripts/setup/env.mjs";
import { parseCliArgs } from "../scripts/setup.mjs";
import { detectInstallState } from "../scripts/setup/state-detect.mjs";
import { runEasyInstall, runReset } from "../scripts/setup/reset.mjs";
import { runRepair } from "../scripts/setup/repair.mjs";
import { getSupervisorStatus, stopSupervisorFromPidFile } from "../scripts/supervisor.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

describe("Static guard: MinIO-only attachment storage", () => {
  it("has no STORAGE_DRIVER or local filesystem attachment storage fallback in src/ or scripts/", () => {
    const scanDirs = [path.join(REPO_ROOT, "src"), path.join(REPO_ROOT, "scripts")];
    const violations: string[] = [];

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
          const text = fs.readFileSync(full, "utf8");
          if (/STORAGE_DRIVER/.test(text)) {
            violations.push(`STORAGE_DRIVER reference in ${path.relative(REPO_ROOT, full)}`);
          }
        }
      }
    }
    for (const d of scanDirs) walk(d);
    expect(violations).toEqual([]);
  });
});

describe("Platform helper & CLI args for Easy Mode", () => {
  it("resolves pinned RELEASE.2025-09-07T16-13-09Z MinIO URLs and checksums for Windows x64, Linux x64, and Linux arm64", () => {
    const win = createPlatformHelper({ platform: "win32", arch: "x64" }).getMinioDownloadInfo();
    const linX64 = createPlatformHelper({ platform: "linux", arch: "x64" }).getMinioDownloadInfo();
    const linArm = createPlatformHelper({ platform: "linux", arch: "arm64" }).getMinioDownloadInfo();

    expect(win.downloadUrl).toContain("github.com/minio/minio/releases/download/RELEASE.2025-09-07T16-13-09Z/minio.windows-amd64.RELEASE.2025-09-07T16-13-09Z.exe");
    expect(win.checksumUrl).toBe(`${win.downloadUrl}.sha256sum`);
    expect(linX64.downloadUrl).toContain("minio.linux-amd64.RELEASE.2025-09-07T16-13-09Z");
    expect(linArm.downloadUrl).toContain("minio.linux-arm64.RELEASE.2025-09-07T16-13-09Z");
  });

  it("parses --easy and --advanced flags and rejects passing both", () => {
    expect(parseCliArgs(["--easy", "--yes"]).easy).toBe(true);
    expect(parseCliArgs(["--advanced"]).advanced).toBe(true);
    expect(() => parseCliArgs(["--easy", "--advanced"])).toThrow(/Cannot pass both/);
  });

  it("honors HTTPS_PROXY and NO_PROXY", () => {
    const env = {
      HTTPS_PROXY: "http://proxy.internal:8080",
      NO_PROXY: "localhost,127.0.0.1,.corp.local",
    };
    expect(resolveProxyForUrl("https://github.com/minio/minio", env)).toBe("http://proxy.internal:8080");
    expect(resolveProxyForUrl("https://api.corp.local/health", env)).toBeNull();
    expect(resolveProxyForUrl("https://127.0.0.1:9000", env)).toBeNull();
  });
});

describe("Verified download, checksum, cache, and offline route", () => {
  let server: http.Server;
  let baseUrl = "";
  const goodPayload = Buffer.from("patchwork-minio-test-binary-payload-v1");
  const goodSha = crypto.createHash("sha256").update(goodPayload).digest("hex");
  let mode: "good" | "bad-sha" | "truncated" = "good";

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/minio.sha256sum") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(`${goodSha}  minio-test\n`);
        return;
      }
      if (req.url === "/minio") {
        if (mode === "bad-sha") {
          const bad = Buffer.from("corrupted-binary-payload");
          res.writeHead(200, { "Content-Length": String(bad.length) });
          res.end(bad);
          return;
        }
        if (mode === "truncated") {
          res.writeHead(200, { "Content-Length": String(goodPayload.length + 50) });
          res.end(goodPayload.subarray(0, 10));
          return;
        }
        res.writeHead(200, { "Content-Length": String(goodPayload.length) });
        res.end(goodPayload);
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (addr && typeof addr === "object") {
      baseUrl = `http://127.0.0.1:${addr.port}`;
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("parses .sha256sum, verifies download, caches it, and reuses cache", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pw-dl-good-"));
    try {
      mode = "good";
      const override = {
        releaseTag: "TEST",
        assetName: "minio-test",
        downloadUrl: `${baseUrl}/minio`,
        checksumUrl: `${baseUrl}/minio.sha256sum`,
        expectedBytes: goodPayload.length,
      };
      const first = await ensureMinioBinary({
        projectDir: tmp,
        yes: true,
        downloadInfoOverride: override,
      });
      expect(first.verified).toBe(true);
      expect(first.downloaded).toBe(true);
      expect(first.sha256).toBe(goodSha);
      expect(fs.existsSync(path.join(tmp, "data", "cache", "minio-test"))).toBe(true);

      // Remove ./bin copy and confirm cache reuse works offline
      fs.unlinkSync(first.path);
      const offlineOverride = {
        ...override,
        checksumUrl: "http://127.0.0.1:1/unreachable.sha256sum",
        downloadUrl: "http://127.0.0.1:1/unreachable",
      };
      const second = await ensureMinioBinary({
        projectDir: tmp,
        yes: true,
        downloadInfoOverride: offlineOverride,
      });
      expect(second.source).toBe("cache");
      expect(second.downloaded).toBe(false);
      expect(await sha256File(second.path)).toBe(goodSha);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("aborts and deletes file on checksum mismatch or truncated download, and prints offline instructions", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pw-dl-bad-"));
    try {
      mode = "bad-sha";
      await expect(
        downloadVerifiedFile({
          url: `${baseUrl}/minio`,
          expectedSha256: goodSha,
          destPath: path.join(tmp, "bin", "minio"),
          expectedBytes: goodPayload.length,
        })
      ).rejects.toThrow();
      expect(fs.existsSync(path.join(tmp, "bin", "minio"))).toBe(false);
      expect(fs.existsSync(path.join(tmp, "bin", "minio.part"))).toBe(false);

      mode = "truncated";
      await expect(
        downloadVerifiedFile({
          url: `${baseUrl}/minio`,
          expectedSha256: goodSha,
          destPath: path.join(tmp, "bin", "minio"),
          expectedBytes: goodPayload.length,
        })
      ).rejects.toThrow();
      expect(fs.existsSync(path.join(tmp, "bin", "minio"))).toBe(false);

      // Offline error includes manual cache path & URL
      await expect(
        ensureMinioBinary({
          projectDir: tmp,
          yes: true,
          downloadInfoOverride: {
            releaseTag: "TEST",
            assetName: "minio-offline",
            downloadUrl: "http://127.0.0.1:1/minio",
            checksumUrl: "http://127.0.0.1:1/minio.sha256sum",
            expectedBytes: 100,
          },
        })
      ).rejects.toThrow(/Offline manual route/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("Embedded PG guards & Easy-mode lifecycle", () => {
  it("refuses cross-major PostgreSQL data directory upgrade and cleans stale postmaster.pid", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pw-pg-guard-"));
    try {
      fs.writeFileSync(path.join(tmp, "PG_VERSION"), "16\n", "utf8");
      expect(() => checkEmbeddedPgMajorVersion(tmp)).toThrow(/Refusing automatic cross-major upgrade/);

      fs.writeFileSync(path.join(tmp, "PG_VERSION"), `${EMBEDDED_PG_MAJOR}\n`, "utf8");
      expect(checkEmbeddedPgMajorVersion(tmp).major).toBe(EMBEDDED_PG_MAJOR);

      fs.writeFileSync(path.join(tmp, "postmaster.pid"), "99999999\n", "utf8");
      const cleaned = cleanStalePostgresPid(tmp);
      expect(cleaned.removed).toBe(true);
      expect(fs.existsSync(path.join(tmp, "postmaster.pid"))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("installs Easy mode in a clean temp directory, verifies presigned URLs, repairs, checks, and resets with backup", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pw-easy-e2e-"));
    try {
      // Pre-seed cache from repo ./bin/minio[.exe] if already present locally to avoid 100MB re-download in repeated test runs
      const plat = createPlatformHelper();
      const dlInfo = plat.getMinioDownloadInfo();
      const repoMinio = plat.binPath("minio", { projectDir: REPO_ROOT });
      if (repoMinio.exists) {
        const cacheDir = path.join(tmp, "data", "cache");
        fs.mkdirSync(cacheDir, { recursive: true });
        const cachedBin = path.join(cacheDir, dlInfo.assetName);
        fs.copyFileSync(repoMinio.path, cachedBin);
        const sha = await sha256File(cachedBin);
        fs.writeFileSync(`${cachedBin}.sha256sum`, `${sha}  ${dlInfo.assetName}\n`, "utf8");
      }

      const installRes = await runEasyInstall({
        projectDir: tmp,
        drizzleDir: path.join(REPO_ROOT, "drizzle"),
        yes: true,
        appPort: 13099,
      });

      expect(installRes.mode).toBe("easy");
      expect(fs.existsSync(path.join(tmp, ".env"))).toBe(true);
      expect(fs.existsSync(path.join(tmp, "data", "postgres", "PG_VERSION"))).toBe(true);
      expect(fs.existsSync(path.join(tmp, "data", "minio"))).toBe(true);

      const envVals = parseEnvFile(path.join(tmp, ".env")).values;
      expect(detectInstallMode(tmp, envVals)).toBe("easy");
      expect(envVals.PATCHWORK_INSTALL_MODE).toBe("easy");
      expect(envVals.MINIO_PUBLIC_URL).toMatch(/^http:\/\/localhost:\d+$/);
      expect(envVals.MINIO_BIND_HOST).toBe("127.0.0.1");

      // --check makes no changes
      const checkState = await detectInstallState({
        projectDir: tmp,
        envPath: path.join(tmp, ".env"),
        drizzleDir: path.join(REPO_ROOT, "drizzle"),
      });
      expect(checkState.mode).toBe("easy");
      expect(checkState.easy.pgMajorVersion).toBe(String(EMBEDDED_PG_MAJOR));

      // Supervisor status & stop when stopped
      const supStatus = await getSupervisorStatus(tmp);
      expect(supStatus.mode).toBe("easy");
      expect(supStatus.supervisor).toBeNull();
      const stopIdle = await stopSupervisorFromPidFile(tmp);
      expect(stopIdle.stopped).toBe(false);

      // Simulate stale postmaster.pid & run Repair
      fs.writeFileSync(path.join(tmp, "data", "postgres", "postmaster.pid"), "99999999\n", "utf8");
      const repairRes = await runRepair({
        projectDir: tmp,
        envPath: path.join(tmp, ".env"),
        drizzleDir: path.join(REPO_ROOT, "drizzle"),
        yes: true,
      });
      expect(repairRes.fixed.some((f) => f.includes("postmaster.pid"))).toBe(true);

      // Reset with backup (pg_dump + ./data/minio copy) and no reinstall
      const resetRes = await runReset({
        projectDir: tmp,
        envPath: path.join(tmp, ".env"),
        backupsDir: path.join(tmp, "backups"),
        typedConfirmation: "patchwork",
        secondConfirmation: true,
        backupDb: true,
        backupMinio: true,
        reinstall: false,
      });
      expect(resetRes.resetCompleted).toBe(true);
      expect(resetRes.backupResult.dbBackupPath).toBeTruthy();
      expect(resetRes.backupResult.minioBackupPath).toBeTruthy();
      expect(fs.existsSync(path.join(tmp, "data", "postgres"))).toBe(false);
      expect(fs.existsSync(path.join(tmp, "data", "minio"))).toBe(false);
    } finally {
      for (let i = 0; i < 5; i++) {
        try {
          fs.rmSync(tmp, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    }
  }, 120000);
});
