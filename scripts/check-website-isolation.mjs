import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const IGNORE_DIRS = new Set(["node_modules", "dist", ".astro", "test-results", "playwright-report"]);
const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".astro"]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) walk(full, out);
    } else if (CODE_EXTS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

export function checkWebsiteIsolation(repoRoot = process.cwd()) {
  const errors = [];
  const websiteDir = path.join(repoRoot, "website");
  if (!fs.existsSync(websiteDir)) {
    return ["Missing website/ directory."];
  }

  // 1. website/package.json must not use workspace: or file:.. dependencies
  const webPkgPath = path.join(websiteDir, "package.json");
  if (fs.existsSync(webPkgPath)) {
    const webPkg = JSON.parse(fs.readFileSync(webPkgPath, "utf8"));
    for (const sec of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [dep, ver] of Object.entries(webPkg[sec] || {})) {
        const v = String(ver);
        if (v.startsWith("workspace:") || v.startsWith("file:..")) {
          errors.push(`website/package.json ${sec}.${dep} uses forbidden cross-repo reference "${v}".`);
        }
      }
    }
  }

  // 2. No file in website/ may import/require/read paths escaping website/
  for (const file of walk(websiteDir)) {
    const rel = path.relative(repoRoot, file).replace(/\\/g, "/");
    const content = fs.readFileSync(file, "utf8");

    // Check static imports / requires / fs reads with relative ../ paths
    for (const m of content.matchAll(/(?:from|import|require)\s*\(?\s*["'](\.\.[^"']+)["']/g)) {
      const target = path.resolve(path.dirname(file), m[1]);
      if (!target.startsWith(websiteDir + path.sep) && target !== websiteDir) {
        errors.push(`Isolation violation in ${rel}: import "${m[1]}" escapes website/`);
      }
    }
    for (const m of content.matchAll(/(?:path\.(?:resolve|join)|readFileSync|existsSync)\([^)]*["'](\.\.[^"']+)["']/g)) {
      const target = path.resolve(path.dirname(file), m[1]);
      if (!target.startsWith(websiteDir + path.sep) && target !== websiteDir) {
        errors.push(`Isolation violation in ${rel}: path "${m[1]}" escapes website/`);
      }
    }
  }

  // 3. Reverse check: app src/ must never import from website/
  const srcDir = path.join(repoRoot, "src");
  for (const file of walk(srcDir)) {
    const rel = path.relative(repoRoot, file).replace(/\\/g, "/");
    const content = fs.readFileSync(file, "utf8");
    if (/from\s+["'][^"']*website\//.test(content) || /require\([^)]*website\//.test(content)) {
      errors.push(`Reverse isolation violation in ${rel}: app source imports from website/`);
    }
  }

  return errors;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const errs = checkWebsiteIsolation();
  if (errs.length > 0) {
    console.error("website isolation check failed:");
    for (const e of errs) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log("website isolation check passed.");
}
