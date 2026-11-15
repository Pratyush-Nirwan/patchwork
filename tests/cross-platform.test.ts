import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createPlatformHelper, sanitizeFilename as sanitizeScriptFilename } from "../scripts/lib/platform.mjs";
import { sanitizeFilename, defaultMinioDataDir } from "@/lib/platform";
import { writeEnvFileAtomic, buildFreshEnvValues } from "../scripts/setup/env.mjs";
import { detectPostgresAuthGuidance } from "../scripts/setup/db.mjs";
import { generateCaddyfileContent, generateNginxConfContent } from "../scripts/setup/domain.mjs";

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", "qa-screenshots"].includes(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, out);
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("Cross-Platform Static & Runtime Suite", () => {
  it("keeps process.platform and process.arch isolated to platform helper modules", () => {
    const allowed = new Set([
      path.resolve("scripts/lib/platform.mjs"),
      path.resolve("src/lib/platform.ts"),
      path.resolve("tests/cross-platform.test.ts"),
    ]);

    const files = [
      ...walkSourceFiles("src"),
      ...walkSourceFiles("scripts"),
      ...walkSourceFiles("tests"),
      ...walkSourceFiles("e2e"),
    ];

    const violations: string[] = [];
    for (const f of files) {
      if (allowed.has(path.resolve(f))) continue;
      const content = fs.readFileSync(f, "utf8");
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (/process\.(platform|arch)\b/.test(line)) {
          violations.push(`${f}:${idx + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it("forbids OS-specific shell scripts and OS-specific package.json script syntax", () => {
    const scriptFiles = fs.readdirSync("scripts");
    const badShellScripts = scriptFiles.filter((f) =>
      /\.(sh|bat|ps1|cmd)$/i.test(f)
    );
    expect(badShellScripts).toEqual([]);

    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    for (const [name, cmd] of Object.entries<string>(pkg.scripts || {})) {
      expect(cmd, `script ${name} uses &&`).not.toContain("&&");
      expect(cmd, `script ${name} uses rm -rf`).not.toMatch(/\brm\s+-rf\b/);
      expect(cmd, `script ${name} uses set VAR=`).not.toMatch(/^set\s+[A-Z0-9_]+=/i);
      expect(cmd, `script ${name} uses raw VAR=val`).not.toMatch(/^[A-Z0-9_]+=\S+\s+/);
    }
  });

  it("forbids hardcoded Windows drive letters or /tmp/ paths in src and scripts", () => {
    const files = [...walkSourceFiles("src"), ...walkSourceFiles("scripts")];
    const allowed = new Set([path.resolve("scripts/lib/platform.mjs")]);
    const violations: string[] = [];

    for (const f of files) {
      if (allowed.has(path.resolve(f))) continue;
      const content = fs.readFileSync(f, "utf8");
      if (/['"`][A-Za-z]:\\\\/.test(content) || /['"`]\/tmp\//.test(content)) {
        violations.push(f);
      }
    }
    expect(violations).toEqual([]);
  });

  it("resolves MinIO binary, download URLs, and npm shims across mocked OS/arch combinations", () => {
    const win = createPlatformHelper({ platform: "win32", arch: "x64" });
    expect(win.isWindows).toBe(true);
    expect(win.isLinux).toBe(false);
    expect(win.npmBin("npm")).toBe("npm.cmd");
    const winMinio = win.binPath("minio");
    expect(winMinio.file).toBe("minio.exe");
    expect(winMinio.downloadUrl).toBe(
      "https://dl.min.io/server/minio/release/windows-amd64/minio.exe"
    );
    expect(winMinio.installCommand).toContain("Invoke-WebRequest");

    const linuxX64 = createPlatformHelper({ platform: "linux", arch: "x64" });
    expect(linuxX64.isLinux).toBe(true);
    expect(linuxX64.npmBin("npm")).toBe("npm");
    const linuxX64Minio = linuxX64.binPath("minio");
    expect(linuxX64Minio.file).toBe("minio");
    expect(linuxX64Minio.downloadUrl).toBe(
      "https://dl.min.io/server/minio/release/linux-amd64/minio"
    );
    expect(linuxX64Minio.installCommand).toContain("chmod +x");

    const linuxArm64 = createPlatformHelper({ platform: "linux", arch: "arm64" });
    expect(linuxArm64.binPath("minio").downloadUrl).toBe(
      "https://dl.min.io/server/minio/release/linux-arm64/minio"
    );

    const macArm64 = createPlatformHelper({ platform: "darwin", arch: "arm64" });
    expect(macArm64.isMac).toBe(true);
    expect(macArm64.binPath("minio").downloadUrl).toBe(
      "https://dl.min.io/server/minio/release/darwin-arm64/minio"
    );
  });

  it("sanitizes Windows reserved names, forbidden chars, trailing dots, unicode, and long filenames", () => {
    expect(sanitizeFilename("CON")).toBe("_CON");
    expect(sanitizeFilename("nul.txt")).toBe("_nul.txt");
    expect(sanitizeFilename("COM1.log")).toBe("_COM1.log");
    expect(sanitizeFilename("bad<name>:file?.txt")).toBe("bad_name__file_.txt");
    expect(sanitizeFilename("trailing.txt.   ")).toBe("trailing.txt");
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("日本語-レポート.md")).toBe("日本語-レポート.md");

    const longName = `${"a".repeat(250)}.pdf`;
    const sanitizedLong = sanitizeFilename(longName);
    expect(sanitizedLong.length).toBeLessThanOrEqual(180);
    expect(sanitizedLong.endsWith(".pdf")).toBe(true);

    expect(sanitizeScriptFilename("CON.csv")).toBe("_CON.csv");
    expect(defaultMinioDataDir("patchwork")).toContain(
      path.join(".minio-data", "patchwork")
    );
  });

  it("writes .env atomically with LF line endings and verifies OS permissions honestly", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "patchwork-xp-env-"));
    try {
      const envPath = path.join(tmpDir, ".env");
      const values = buildFreshEnvValues({
        databaseUrl: "postgres://postgres:postgres@127.0.0.1:5432/patchwork_test",
        appPort: 3000,
      });
      const res = writeEnvFileAtomic(envPath, values, { backup: false });
      expect(res.changed).toBe(true);
      expect(res.permission.enforced).toBe(true);

      const raw = fs.readFileSync(envPath, "utf8");
      expect(raw.includes("\r\n")).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("generates LF-only proxy configs and provides PostgreSQL auth guidance", () => {
    const caddy = generateCaddyfileContent({ domain: "tickets.example.com" });
    const nginx = generateNginxConfContent({ domain: "tickets.example.com" });
    expect(caddy.includes("\r\n")).toBe(false);
    expect(nginx.includes("\r\n")).toBe(false);

    const guidance = detectPostgresAuthGuidance(
      new Error("password authentication failed for user postgres (28P01)")
    );
    expect(guidance).toMatch(/pg_hba\.conf/i);

    const helper = createPlatformHelper();
    expect(helper.killProcessTree(-1)).toBe(false);
  });
});

