import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findRepoRoot,
  extractCommands,
  extractShortcuts,
  extractPermissions,
  extractEnvVars,
  extractSystemSettings,
  extractDatabaseSchema,
  extractInstallerCli,
  extractApiRouteGroups,
} from "./extract.mjs";
import { getVersionInfo } from "../lib/version.mjs";

function sortDeterministic(value) {
  if (Array.isArray(value)) {
    return value.map(sortDeterministic);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortDeterministic(value[key]);
    }
    return out;
  }
  return value;
}

function writeJsonDeterministic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const json = `${JSON.stringify(sortDeterministic(data), null, 2)}\n`;
  fs.writeFileSync(filePath, json, "utf8");
}

export function exportWebsiteData(
  repoRoot = findRepoRoot(),
  outputDir = path.join(repoRoot, "website/src/data/generated")
) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const versionInfo = getVersionInfo(repoRoot);
  const rawRepoUrl = pkg.repository?.url || "https://github.com/Pratyush-Nirwan/patchwork.git";
  const repoUrl = rawRepoUrl.replace(/^git\+/, "").replace(/\.git$/, "");

  const appMeta = {
    name: "Patchwork",
    packageName: pkg.name || "patchwork",
    version: versionInfo.version,
    displayVersion: versionInfo.displayVersion,
    channel: versionInfo.channel,
    license: (pkg.license || "AGPL-3.0-only").replace("-only", ""),
    nodeRequirement: pkg.engines?.node || ">=20",
    supportedOs: ["Windows 10/11", "Linux (Ubuntu 22.04/24.04, Debian 12)"],
    repositoryUrl: repoUrl,
    cloneUrl: rawRepoUrl.replace(/^git\+/, ""),
    docsSiteUrl: process.env.DOCS_SITE_URL || "https://pratyush-nirwan.github.io/patchwork/",
  };

  const snapshots = new Map([
    ["app-meta.json", appMeta],
    ["commands.json", extractCommands(repoRoot)],
    ["shortcuts.json", extractShortcuts(repoRoot)],
    ["permissions.json", extractPermissions(repoRoot)],
    ["env.json", extractEnvVars(repoRoot)],
    ["settings.json", extractSystemSettings(repoRoot)],
    [
      "schema.json",
      {
        tables: extractDatabaseSchema(repoRoot),
        apiRouteGroups: extractApiRouteGroups(repoRoot),
      },
    ],
    ["installer-flags.json", extractInstallerCli(repoRoot)],
  ]);

  fs.mkdirSync(outputDir, { recursive: true });
  for (const [name, data] of snapshots.entries()) {
    writeJsonDeterministic(path.join(outputDir, name), data);
  }

  // Verbatim copy of root CHANGELOG.md
  const changelogSrc = path.join(repoRoot, "CHANGELOG.md");
  if (fs.existsSync(changelogSrc)) {
    const raw = fs.readFileSync(changelogSrc, "utf8").replace(/\r\n/g, "\n");
    fs.writeFileSync(path.join(outputDir, "CHANGELOG.md"), raw, "utf8");
  }

  return [...snapshots.keys(), "CHANGELOG.md"];
}

export function checkExportDrift(repoRoot = findRepoRoot()) {
  const committedDir = path.join(repoRoot, "website/src/data/generated");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-export-check-"));
  const errors = [];
  try {
    const files = exportWebsiteData(repoRoot, tmpDir);
    for (const f of files) {
      const committedPath = path.join(committedDir, f);
      const freshPath = path.join(tmpDir, f);
      if (!fs.existsSync(committedPath)) {
        errors.push(`Missing exported snapshot: website/src/data/generated/${f}. Run npm run docs:export.`);
        continue;
      }
      const a = fs.readFileSync(committedPath, "utf8").replace(/\r\n/g, "\n");
      const b = fs.readFileSync(freshPath, "utf8").replace(/\r\n/g, "\n");
      if (a !== b) {
        errors.push(`Exported snapshot out of date: website/src/data/generated/${f}. Run npm run docs:export.`);
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return errors;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const repoRoot = findRepoRoot();
  const outIdx = process.argv.indexOf("--out-dir");
  const outDir =
    outIdx !== -1 && process.argv[outIdx + 1]
      ? path.resolve(process.argv[outIdx + 1])
      : path.join(repoRoot, "website/src/data/generated");
  const files = exportWebsiteData(repoRoot, outDir);
  console.log(`Exported ${files.length} snapshots to ${path.relative(repoRoot, outDir)}`);
}
