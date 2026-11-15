import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findRepoRoot } from "./extract.mjs";
import { getVersionInfo } from "../lib/version.mjs";

export function copyDocsDist({
  repoRoot = findRepoRoot(),
  sourceDir = path.join(repoRoot, "docs-site/dist"),
  targetDir = path.join(repoRoot, "documentation-dist"),
  base = process.env.DOCS_BASE ?? "/documentation",
} = {}) {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Docs build directory missing: ${sourceDir}`);
  }
  const entries = fs.readdirSync(sourceDir);
  if (entries.length === 0) {
    throw new Error(`Docs build directory is empty: ${sourceDir}`);
  }
  const indexHtml = path.join(sourceDir, "index.html");
  if (!fs.existsSync(indexHtml)) {
    throw new Error(`Docs build missing index.html: ${indexHtml}`);
  }

  const versionInfo = getVersionInfo(repoRoot);
  const stamp = `${process.pid}-${Date.now()}`;
  const parentDir = path.dirname(targetDir);
  const baseName = path.basename(targetDir);
  const tmpDir = path.join(parentDir, `${baseName}.tmp-${stamp}`);
  const bakDir = path.join(parentDir, `${baseName}.bak-${stamp}`);

  fs.mkdirSync(parentDir, { recursive: true });
  fs.cpSync(sourceDir, tmpDir, { recursive: true, dereference: true });

  const buildInfo = {
    version: versionInfo.version,
    displayVersion: versionInfo.displayVersion,
    base: base === "" || base === "/" ? "/" : `/${base.replace(/^\/+|\/+$/g, "")}`,
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(tmpDir, ".build-info.json"),
    `${JSON.stringify(buildInfo, null, 2)}\n`,
    "utf8"
  );

  // Atomic swap
  try {
    if (fs.existsSync(targetDir)) {
      fs.renameSync(targetDir, bakDir);
    }
    fs.renameSync(tmpDir, targetDir);
    if (fs.existsSync(bakDir)) {
      fs.rmSync(bakDir, { recursive: true, force: true });
    }
  } catch (err) {
    if (!fs.existsSync(targetDir) && fs.existsSync(bakDir)) {
      try {
        fs.renameSync(bakDir, targetDir);
      } catch {
        // Best-effort rollback
      }
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    throw err;
  }

  return buildInfo;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const info = copyDocsDist();
  console.log(
    `Copied docs build (v${info.version}, base=${info.base}) to documentation-dist/`
  );
}
