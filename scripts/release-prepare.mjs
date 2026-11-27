import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { npmBin } from "./lib/platform.mjs";
import {
  DEFAULT_REPO_ROOT,
  isValidSemver,
  syncPackageVersions,
} from "./lib/version.mjs";
import { checkVersionConsistency } from "./check-version.mjs";
import { renderReadme } from "./docs/readme.mjs";

const REPO_URL = "https://github.com/Pratyush-Nirwan/patchwork";

function updateReadmeBadge(repoRoot, displayVersion) {
  const templatePath = path.join(repoRoot, "docs", "README.template.md");
  const readmePath = path.join(repoRoot, "README.md");
  if (fs.existsSync(templatePath)) {
    fs.writeFileSync(readmePath, renderReadme(repoRoot), "utf8");
    return;
  }
  if (!fs.existsSync(readmePath)) return;
  const escaped = displayVersion.replace(/-/g, "--");
  const original = fs.readFileSync(readmePath, "utf8");
  const updated = original
    .replace(/!\[Version [^\]]+\]/g, `![Version ${displayVersion}]`)
    .replace(
      /https:\/\/img\.shields\.io\/badge\/version-[^)?\s]+-(blue|[0-9A-Fa-f]{6})/g,
      `https://img.shields.io/badge/version-${escaped}-$1`
    );
  if (updated !== original) {
    fs.writeFileSync(readmePath, updated, "utf8");
  }
}

function rollChangelog(repoRoot, displayVersion, today) {
  const changelogPath = path.join(repoRoot, "CHANGELOG.md");
  if (!fs.existsSync(changelogPath)) {
    throw new Error("CHANGELOG.md not found");
  }

  const content = fs.readFileSync(changelogPath, "utf8").replace(/\r\n/g, "\n");
  const unreleasedHeader = "## [Unreleased]";
  const idx = content.indexOf(unreleasedHeader);
  if (idx === -1) {
    throw new Error("Could not find '## [Unreleased]' in CHANGELOG.md");
  }

  const afterHeader = content.slice(idx + unreleasedHeader.length);
  const nextSectionMatch = afterHeader.match(/\n## \[/);
  const linksMatch = afterHeader.match(/\n\[Unreleased\]:/);
  const bodyEndIdx = nextSectionMatch
    ? nextSectionMatch.index
    : linksMatch
      ? linksMatch.index
      : afterHeader.length;

  const unreleasedBody = afterHeader.slice(0, bodyEndIdx).trim();
  const rest = afterHeader.slice(bodyEndIdx);

  const releaseHeading = `## [${displayVersion}] - ${today}`;
  const releaseBlock = unreleasedBody
    ? `${unreleasedHeader}\n\n${releaseHeading}\n\n${unreleasedBody}`
    : `${unreleasedHeader}\n\n${releaseHeading}\n\n### Changed\n- **System Configuration:** Version bump to ${displayVersion}.`;

  let updated = `${content.slice(0, idx)}${releaseBlock}${rest.startsWith("\n") ? rest : `\n${rest}`}`;

  // Update compare links at bottom
  const prevTagMatch = rest.match(/\n## \[([^\]]+)\]/);
  const prevTag = prevTagMatch ? prevTagMatch[1] : null;
  const compareLine = `[Unreleased]: ${REPO_URL}/compare/${displayVersion}...HEAD`;
  const tagLine = prevTag
    ? `[${displayVersion}]: ${REPO_URL}/compare/${prevTag}...${displayVersion}`
    : `[${displayVersion}]: ${REPO_URL}/releases/tag/${displayVersion}`;

  if (/^\[Unreleased\]:.*$/m.test(updated)) {
    updated = updated.replace(/^\[Unreleased\]:.*$/m, `${compareLine}\n${tagLine}`);
  } else {
    updated = `${updated.trimEnd()}\n\n${compareLine}\n${tagLine}\n`;
  }

  fs.writeFileSync(changelogPath, updated, "utf8");
}

export function prepareRelease({
  repoRoot = DEFAULT_REPO_ROOT,
  targetVersion = "",
  syncLockfiles = true,
  runChecks = true,
  today = new Date().toISOString().slice(0, 10),
} = {}) {
  const clean = String(targetVersion || "").trim().replace(/^v/, "");
  if (!isValidSemver(clean)) {
    throw new Error(
      `Invalid SemVer version "${targetVersion}". Expected e.g. 0.7.0-beta or 0.8.0.`
    );
  }

  const info = syncPackageVersions(repoRoot, clean, { syncLockfiles });
  updateReadmeBadge(repoRoot, info.displayVersion);
  rollChangelog(repoRoot, info.displayVersion, today);

  if (runChecks) {
    const npm = npmBin("npm");
    const useShell = npm.endsWith(".cmd");
    for (const script of ["docs:generate", "changelog:check", "docs:check", "version:check"]) {
      execFileSync(npm, ["run", script], {
        cwd: repoRoot,
        stdio: "inherit",
        shell: useShell,
      });
    }
  } else {
    const errs = checkVersionConsistency(repoRoot);
    if (errs.length > 0) {
      throw new Error(`version:check failed:\n- ${errs.join("\n- ")}`);
    }
  }

  const commands = [
    "git add -A",
    `git commit -m "chore(release): ${info.tag}"`,
    `git tag -a ${info.tag} -m "Patchwork ${info.tag}"`,
    `git push && git push origin ${info.tag}`,
  ];

  return {
    ...info,
    today,
    commands,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const argVersion = process.argv[2];
  if (!argVersion) {
    console.error("Usage: npm run release:prepare -- <version>");
    process.exit(1);
  }
  const result = prepareRelease({ targetVersion: argVersion });
  console.log(`\nPrepared release ${result.displayVersion} (${result.today}).`);
  console.log("Run these commands to commit and tag (not executed automatically):");
  for (const cmd of result.commands) {
    console.log(`  ${cmd}`);
  }
}
