import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { npmBin } from "./platform.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = path.resolve(__dirname, "../..");

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function isValidSemver(value) {
  return typeof value === "string" && SEMVER_RE.test(value.trim());
}

export function parseSemver(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/^v/, "");
  const m = cleaned.match(SEMVER_RE);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split(".") : [],
  };
}

export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;

  for (const key of ["major", "minor", "patch"]) {
    if (pa[key] !== pb[key]) return pa[key] > pb[key] ? 1 : -1;
  }

  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;

  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const idA = pa.prerelease[i];
    const idB = pb.prerelease[i];
    if (idA === undefined) return -1;
    if (idB === undefined) return 1;
    const numA = /^\d+$/.test(idA) ? Number(idA) : null;
    const numB = /^\d+$/.test(idB) ? Number(idB) : null;
    if (numA !== null && numB !== null) {
      if (numA !== numB) return numA > numB ? 1 : -1;
    } else if (numA !== null) {
      return -1;
    } else if (numB !== null) {
      return 1;
    } else if (idA !== idB) {
      return idA > idB ? 1 : -1;
    }
  }
  return 0;
}

export function getChannelForVersion(ver) {
  const parsed = parseSemver(ver);
  if (!parsed || parsed.prerelease.length === 0) return "stable";
  const pre = parsed.prerelease[0].toLowerCase();
  if (pre.startsWith("beta")) return "beta";
  if (pre.startsWith("alpha")) return "alpha";
  if (pre.startsWith("rc")) return "rc";
  return pre;
}

export function getVersionInfo(repoRoot = DEFAULT_REPO_ROOT) {
  const pkgPath = path.join(repoRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const ver = String(pkg.version || "").trim();
  if (!isValidSemver(ver)) {
    throw new Error(`Invalid SemVer in ${pkgPath}: "${ver}"`);
  }
  return {
    version: ver,
    displayVersion: `v${ver}`,
    tag: `v${ver}`,
    channel: getChannelForVersion(ver),
  };
}

export function syncPackageVersions(
  repoRoot = DEFAULT_REPO_ROOT,
  targetVersion,
  { syncLockfiles = true } = {}
) {
  const cleanVersion = String(targetVersion || "").trim().replace(/^v/, "");
  if (!isValidSemver(cleanVersion)) {
    throw new Error(`Invalid SemVer version: "${targetVersion}"`);
  }

  for (const rel of ["package.json", "website/package.json"]) {
    const filePath = path.join(repoRoot, rel);
    if (!fs.existsSync(filePath)) continue;
    const pkg = JSON.parse(fs.readFileSync(filePath, "utf8"));
    pkg.version = cleanVersion;
    fs.writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  }

  if (syncLockfiles) {
    const npm = npmBin("npm");
    const useShell = npm.endsWith(".cmd");
    execFileSync(npm, ["install", "--package-lock-only", "--ignore-scripts"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: useShell,
    });
    const docsDir = path.join(repoRoot, "website");
    if (fs.existsSync(path.join(docsDir, "package.json"))) {
      execFileSync(npm, ["install", "--package-lock-only", "--ignore-scripts"], {
        cwd: docsDir,
        stdio: "inherit",
        shell: useShell,
      });
    }
  }

  return getVersionInfo(repoRoot);
}

const current = getVersionInfo();
export const version = current.version;
export const displayVersion = current.displayVersion;
export const tag = current.tag;
export const channel = current.channel;
