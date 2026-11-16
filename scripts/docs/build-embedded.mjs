import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findRepoRoot } from "./extract.mjs";
import { getVersionInfo } from "../lib/version.mjs";
import { npmBin } from "../lib/platform.mjs";

export function buildEmbeddedDocs({
  repoRoot = findRepoRoot(),
  skip = process.env.SKIP_DOCS_BUILD === "1",
} = {}) {
  if (skip) {
    console.log("Skipping embedded docs build (SKIP_DOCS_BUILD=1).");
    return { skipped: true };
  }

  const websiteDir = path.join(repoRoot, "website");
  const npm = npmBin("npm");
  const useShell = npm.endsWith(".cmd");

  if (!fs.existsSync(path.join(websiteDir, "node_modules"))) {
    console.log("Installing @patchwork/website dependencies (website/node_modules missing)...");
    execFileSync(npm, ["ci"], {
      cwd: websiteDir,
      env: process.env,
      stdio: "inherit",
      shell: useShell,
    });
  }

  execFileSync(npm, ["run", "build:embedded"], {
    cwd: websiteDir,
    env: process.env,
    stdio: "inherit",
    shell: useShell,
  });

  const distRoot = path.join(websiteDir, "dist");
  const docsSrc = path.join(distRoot, "documentation");
  if (!fs.existsSync(path.join(docsSrc, "index.html"))) {
    throw new Error(`Embedded docs build missing ${docsSrc}/index.html`);
  }

  const targetDir = path.join(repoRoot, "documentation-dist");
  const stamp = `${process.pid}-${Date.now()}`;
  const tmpDir = path.join(repoRoot, `documentation-dist.tmp-${stamp}`);
  const bakDir = path.join(repoRoot, `documentation-dist.bak-${stamp}`);

  fs.mkdirSync(tmpDir, { recursive: true });
  fs.cpSync(docsSrc, tmpDir, { recursive: true, dereference: true });

  // Copy Pagefind index and public static files into documentation-dist/
  const pagefindSrc = path.join(distRoot, "pagefind");
  if (fs.existsSync(pagefindSrc)) {
    fs.cpSync(pagefindSrc, path.join(tmpDir, "pagefind"), { recursive: true, dereference: true });
  }
  for (const staticFile of ["favicon.svg", "og-image.svg", "changelog.xml", "404.html"]) {
    const src = path.join(distRoot, staticFile);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(tmpDir, staticFile));
    }
  }

  const versionInfo = getVersionInfo(repoRoot);
  fs.writeFileSync(
    path.join(tmpDir, ".build-info.json"),
    `${JSON.stringify(
      {
        version: versionInfo.version,
        displayVersion: versionInfo.displayVersion,
        base: "/documentation",
        builtAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  try {
    if (fs.existsSync(targetDir)) fs.renameSync(targetDir, bakDir);
    fs.renameSync(tmpDir, targetDir);
    if (fs.existsSync(bakDir)) fs.rmSync(bakDir, { recursive: true, force: true });
  } catch (err) {
    if (!fs.existsSync(targetDir) && fs.existsSync(bakDir)) {
      try {
        fs.renameSync(bakDir, targetDir);
      } catch {
        // Best-effort restore
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }

  console.log(`Copied embedded docs (${versionInfo.displayVersion}, base=/documentation) to documentation-dist/`);
  return { skipped: false, targetDir };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  buildEmbeddedDocs();
}
