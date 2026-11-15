import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_REPO_ROOT,
  getVersionInfo,
  isValidSemver,
} from "./lib/version.mjs";

const INVALID_VARIANT_PATTERNS = [
  { name: '"0.7.0 beta" (space instead of hyphen)', regex: /\b0\.7\.0[ \t]+beta\b/i },
  { name: '"Beta 0.7.0" / "beta-0.7.0" (reversed)', regex: /\bbeta[\s-]+0\.7\.0\b/i },
  { name: '"0.7.0beta" (missing hyphen)', regex: /\b0\.7\.0beta\b/i },
];

const SCAN_DIRS = ["src", "scripts", "docs-site/src", "tests", "e2e"];
const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".mjs", ".astro", ".md", ".mdx", ".json"]);

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") {
        continue;
      }
      walkFiles(full, out);
    } else if (entry.isFile() && SCAN_EXTS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

export function checkVersionConsistency(repoRoot = DEFAULT_REPO_ROOT) {
  const errors = [];
  const rootPkgPath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(rootPkgPath)) {
    return [`Missing root package.json at ${rootPkgPath}`];
  }

  let versionInfo;
  try {
    const rawPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
    if (!isValidSemver(rawPkg.version)) {
      errors.push(`Root package.json version "${rawPkg.version}" is not valid SemVer.`);
      return errors;
    }
    versionInfo = getVersionInfo(repoRoot);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return errors;
  }

  const { version, displayVersion } = versionInfo;

  // 1. Root package-lock.json
  const rootLockPath = path.join(repoRoot, "package-lock.json");
  if (fs.existsSync(rootLockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(rootLockPath, "utf8"));
      if (lock.version !== version) {
        errors.push(`package-lock.json version "${lock.version}" != "${version}"`);
      }
      if (lock.packages?.[""]?.version && lock.packages[""].version !== version) {
        errors.push(`package-lock.json packages[""].version "${lock.packages[""].version}" != "${version}"`);
      }
    } catch {
      errors.push("package-lock.json is not valid JSON.");
    }
  }

  // 2. docs-site/package.json & docs-site/package-lock.json
  const docsPkgPath = path.join(repoRoot, "docs-site/package.json");
  if (fs.existsSync(docsPkgPath)) {
    try {
      const docsPkg = JSON.parse(fs.readFileSync(docsPkgPath, "utf8"));
      if (docsPkg.version !== version) {
        errors.push(`docs-site/package.json version "${docsPkg.version}" != "${version}"`);
      }
    } catch {
      errors.push("docs-site/package.json is not valid JSON.");
    }
  }

  const docsLockPath = path.join(repoRoot, "docs-site/package-lock.json");
  if (fs.existsSync(docsLockPath)) {
    try {
      const docsLock = JSON.parse(fs.readFileSync(docsLockPath, "utf8"));
      if (docsLock.version !== version) {
        errors.push(`docs-site/package-lock.json version "${docsLock.version}" != "${version}"`);
      }
      if (docsLock.packages?.[""]?.version && docsLock.packages[""].version !== version) {
        errors.push(`docs-site/package-lock.json packages[""].version "${docsLock.packages[""].version}" != "${version}"`);
      }
    } catch {
      errors.push("docs-site/package-lock.json is not valid JSON.");
    }
  }

  // 3. documentation-dist/.build-info.json (when built)
  const buildInfoPath = path.join(repoRoot, "documentation-dist/.build-info.json");
  if (fs.existsSync(buildInfoPath)) {
    try {
      const info = JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));
      if (info.version !== version) {
        errors.push(`documentation-dist/.build-info.json version "${info.version}" != "${version}"`);
      }
    } catch {
      errors.push("documentation-dist/.build-info.json is not valid JSON.");
    }
  }

  // 4. CHANGELOG.md & docs-site changelog
  const changelogPath = path.join(repoRoot, "CHANGELOG.md");
  if (!fs.existsSync(changelogPath)) {
    errors.push("CHANGELOG.md is missing.");
  } else {
    const changelog = fs.readFileSync(changelogPath, "utf8");
    if (!changelog.includes(`## [${displayVersion}] - `)) {
      errors.push(`CHANGELOG.md missing section "## [${displayVersion}] - <YYYY-MM-DD>".`);
    }
  }

  const docsChangelogPath = path.join(
    repoRoot,
    "docs-site/src/content/docs/project/changelog.mdx"
  );
  if (fs.existsSync(docsChangelogPath)) {
    const docsChangelog = fs.readFileSync(docsChangelogPath, "utf8");
    if (!docsChangelog.includes(`## [${displayVersion}] - `)) {
      errors.push(
        `docs-site/src/content/docs/project/changelog.mdx missing section "## [${displayVersion}] - <YYYY-MM-DD>".`
      );
    }
  }

  // 5. README.md version badge
  const readmePath = path.join(repoRoot, "README.md");
  if (fs.existsSync(readmePath)) {
    const readme = fs.readFileSync(readmePath, "utf8");
    const escapedForBadge = displayVersion.replace(/-/g, "--");
    if (!readme.includes(displayVersion) && !readme.includes(escapedForBadge)) {
      errors.push(`README.md does not reference ${displayVersion}.`);
    }
  }

  // 6. Static scan for invalid display variants
  const selfRel = path.normalize("scripts/check-version.mjs");
  for (const relDir of SCAN_DIRS) {
    for (const filePath of walkFiles(path.join(repoRoot, relDir))) {
      const rel = path.relative(repoRoot, filePath);
      if (path.normalize(rel) === selfRel) continue;
      const content = fs.readFileSync(filePath, "utf8");
      for (const pattern of INVALID_VARIANT_PATTERNS) {
        if (pattern.regex.test(content)) {
          errors.push(`Invalid version display variant (${pattern.name}) found in ${rel}`);
        }
      }
    }
  }

  return errors;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const errors = checkVersionConsistency();
  if (errors.length > 0) {
    console.error("version:check failed:");
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  const { version, displayVersion } = getVersionInfo();
  console.log(`version:check passed (${displayVersion} / ${version}).`);
}
