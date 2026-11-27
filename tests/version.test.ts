import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  version,
  displayVersion,
  tag,
  channel,
  buildDate,
} from "../src/lib/version";
import { GET as healthGet } from "../src/app/api/health/route";
import { generateDiagnosticsBundle } from "../src/lib/diagnostics";
import * as scriptVersion from "../scripts/lib/version.mjs";
import { checkVersionConsistency } from "../scripts/check-version.mjs";
import { prepareRelease } from "../scripts/release-prepare.mjs";
import { detectInstallState, formatStateTable } from "../scripts/setup/state-detect.mjs";
import { runRepair } from "../scripts/setup/repair.mjs";

function createTempRepoCopy({ includeLocksAndBuildInfo = true } = {}): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patchwork-ver-test-"));
  const root = process.cwd();
  const files = [
    "package.json",
    "README.md",
    "CHANGELOG.md",
  ];
  if (includeLocksAndBuildInfo) {
    files.push("package-lock.json");
  }
  for (const rel of files) {
    const src = path.join(root, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  return tmp;
}

const PKG_VERSION = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")
).version as string;
const PKG_DISPLAY_VERSION = `v${PKG_VERSION}`;

describe(`Single-Source Versioning (${PKG_DISPLAY_VERSION})`, () => {
  it("app and script helpers return package.json version, v-prefixed displayVersion, tag, and channel", () => {
    expect(version).toBe(PKG_VERSION);
    expect(displayVersion).toBe(PKG_DISPLAY_VERSION);
    expect(tag).toBe(PKG_DISPLAY_VERSION);
    expect(channel).toBe("beta");
    expect(buildDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(scriptVersion.version).toBe(PKG_VERSION);
    expect(scriptVersion.displayVersion).toBe(PKG_DISPLAY_VERSION);
    expect(scriptVersion.tag).toBe(PKG_DISPLAY_VERSION);
    expect(scriptVersion.channel).toBe("beta");
    expect(scriptVersion.isValidSemver(PKG_VERSION)).toBe(true);
    expect(scriptVersion.compareSemver("0.6.0", PKG_VERSION)).toBeLessThan(0);
    expect(scriptVersion.compareSemver(PKG_VERSION, "99.0.0")).toBeLessThan(0);
  });

  it("/api/health returns version and channel, and diagnostics bundle includes version without secrets", async () => {
    const res = await healthGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe(PKG_VERSION);
    expect(body.displayVersion).toBe(PKG_DISPLAY_VERSION);
    expect(body.channel).toBe("beta");

    const bundle = await generateDiagnosticsBundle();
    expect(bundle.appVersion).toBe(PKG_VERSION);
    expect(bundle.channel).toBe("beta");
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toMatch(/SESSION_SECRET|CSRF_SECRET|TOKEN_ENCRYPTION_KEY|minioadmin/i);
  });

  it("installer state-detect formats displayVersion and Repair flags an older installed version", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patchwork-upgrade-"));
    try {
      const state = await detectInstallState({
        projectDir: tmp,
        envPath: path.join(tmp, ".env"),
        minioDataDir: path.join(tmp, ".minio-data"),
        drizzleDir: path.join(process.cwd(), "drizzle"),
        installedVersion: "0.6.0-beta",
      });
      expect(state.diskVersion).toBe(PKG_VERSION);
      expect(state.diskDisplayVersion).toBe(PKG_DISPLAY_VERSION);
      expect(state.installedVersion).toBe("0.6.0-beta");
      expect(state.upgradeAvailable).toBe(true);

      const table = formatStateTable(state);
      expect(table).toContain(PKG_DISPLAY_VERSION);
      expect(table).toContain("Upgrade available: run migrations");
      expect(table).toContain("https://getpatchwork.in/documentation/operations/backups-and-upgrades/");

      const repair = await runRepair({
        projectDir: tmp,
        envPath: path.join(tmp, ".env"),
        minioDataDir: path.join(tmp, ".minio-data"),
        drizzleDir: path.join(process.cwd(), "drizzle"),
        installedVersion: "0.6.0-beta",
      });
      expect(
        repair.manualActions.some((m) =>
          m.includes("Upgrade available: run migrations") &&
          m.includes("https://getpatchwork.in/documentation/operations/backups-and-upgrades/")
        )
      ).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("version:check passes on clean repo and fails on missing changelog or invalid display variant", () => {
    expect(checkVersionConsistency(process.cwd())).toEqual([]);

    const tmp = createTempRepoCopy();
    try {
      expect(checkVersionConsistency(tmp)).toEqual([]);

      // Missing CHANGELOG.md section
      const clPath = path.join(tmp, "CHANGELOG.md");
      const clOriginal = fs.readFileSync(clPath, "utf8");
      fs.writeFileSync(clPath, "# Changelog\n\n## [Unreleased]\n");
      expect(checkVersionConsistency(tmp).some((e) => e.includes("CHANGELOG.md"))).toBe(true);
      fs.writeFileSync(clPath, clOriginal);

      // Invalid display variant in src/
      const badFile = path.join(tmp, "src/bad-variant.ts");
      fs.mkdirSync(path.dirname(badFile), { recursive: true });
      fs.writeFileSync(badFile, `export const label = "${["0.7.0", "beta"].join(" ")}";\n`);
      expect(checkVersionConsistency(tmp).some((e) => e.includes("Invalid version display variant"))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("release:prepare dry run updates all locations, rolls changelog, and prints git commands without running git", () => {
    const tmp = createTempRepoCopy({ includeLocksAndBuildInfo: false });
    try {
      // Seed an [Unreleased] entry
      const clPath = path.join(tmp, "CHANGELOG.md");
      const cl = fs.readFileSync(clPath, "utf8").replace(
        "## [Unreleased]",
        "## [Unreleased]\n\n### Added\n- Test release feature."
      );
      fs.writeFileSync(clPath, cl);

      const res = prepareRelease({
        repoRoot: tmp,
        targetVersion: "0.8.0-beta.1",
        syncLockfiles: false,
        runChecks: false,
        today: "2026-12-01",
      });

      expect(res.version).toBe("0.8.0-beta.1");
      expect(res.displayVersion).toBe("v0.8.0-beta.1");
      expect(res.tag).toBe("v0.8.0-beta.1");
      expect(res.commands).toContain('git commit -m "chore(release): v0.8.0-beta.1"');
      expect(res.commands.some((c) => c.includes("git tag -a v0.8.0-beta.1"))).toBe(true);

      const rootPkg = JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8"));
      expect(rootPkg.version).toBe("0.8.0-beta.1");

      const updatedCl = fs.readFileSync(clPath, "utf8");
      expect(updatedCl).toContain("## [Unreleased]");
      expect(updatedCl).toContain("## [v0.8.0-beta.1] - 2026-12-01");
      expect(updatedCl).toContain("- Test release feature.");
      expect(updatedCl).toContain("[v0.8.0-beta.1]:");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
