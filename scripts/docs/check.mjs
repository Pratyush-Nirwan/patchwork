import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findRepoRoot } from "./extract.mjs";
import { checkVersionConsistency } from "../check-version.mjs";
import { checkReadme } from "./readme-check.mjs";
import { generateAllDocs } from "./generate.mjs";
import { checkCoverage } from "./coverage.mjs";

function collectMarkdownFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectMarkdownFiles(full));
    } else if (entry.name.endsWith(".md") || entry.name.endsWith(".mdx")) {
      out.push(full);
    }
  }
  return out;
}

export function runDocsChecks(repoRoot = findRepoRoot()) {
  const errors = [];
  const docsContentDir = path.join(repoRoot, "docs-site/src/content/docs");
  const committedRefDir = path.join(docsContentDir, "reference");

  // 1. Freshness check: regenerate into temp dir & compare
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "patchwork-docs-check-"));
  try {
    const generatedFiles = generateAllDocs(repoRoot, tmpDir);
    for (const file of generatedFiles) {
      const committedPath = path.join(committedRefDir, file);
      const freshPath = path.join(tmpDir, file);
      if (!fs.existsSync(committedPath)) {
        errors.push(`Missing generated file in repo: ${committedPath}. Run npm run docs:generate.`);
        continue;
      }
      const committed = fs.readFileSync(committedPath, "utf8").replace(/\r\n/g, "\n");
      const fresh = fs.readFileSync(freshPath, "utf8").replace(/\r\n/g, "\n");
      if (committed !== fresh) {
        errors.push(`Generated doc out of date: reference/${file}. Run npm run docs:generate.`);
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 2. Coverage & staleness check
  errors.push(...checkCoverage(repoRoot, committedRefDir));

  // 3. Frontmatter, runnable npm scripts, screenshots, and repo file path checks
  const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const validScripts = new Set(Object.keys(rootPkg.scripts || {}));
  const files = collectMarkdownFiles(docsContentDir);

  for (const file of files) {
    const rel = path.relative(repoRoot, file).replace(/\\/g, "/");
    const content = fs.readFileSync(file, "utf8");

    // Frontmatter title & description
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) {
      errors.push(`Missing YAML frontmatter in ${rel}`);
    } else {
      if (!/^title:\s*.+/m.test(fmMatch[1])) {
        errors.push(`Missing frontmatter 'title' in ${rel}`);
      }
      if (!/^description:\s*.+/m.test(fmMatch[1])) {
        errors.push(`Missing frontmatter 'description' in ${rel}`);
      }
    }

    // Check runnable `npm run <script>` commands in fenced code blocks
    const codeBlockRegex = /```(?:bash|powershell|pwsh|sh|console)[\r\n]+([\s\S]*?)```/g;
    let cb;
    while ((cb = codeBlockRegex.exec(content)) !== null) {
      const block = cb[1];
      for (const m of block.matchAll(/\bnpm\s+run\s+([a-zA-Z0-9:_-]+)/g)) {
        const scriptName = m[1];
        if (!validScripts.has(scriptName)) {
          errors.push(`Unknown 'npm run ${scriptName}' in ${rel} (not in root package.json)`);
        }
      }
    }

    // Check screenshot references (![alt](...assets/screenshots/...))
    for (const m of content.matchAll(/!\[[^\]]*\]\(([^)]*screenshots\/[^)]+)\)/g)) {
      const imgRel = m[1].split("#")[0].split("?")[0];
      const resolved = path.resolve(path.dirname(file), imgRel);
      if (!fs.existsSync(resolved)) {
        errors.push(`Missing screenshot referenced in ${rel}: ${imgRel}`);
      }
    }

    // Check explicit repo file references in prose like `scripts/setup.mjs` or `deploy/Caddyfile`
    for (const m of content.matchAll(/`((?:scripts|deploy|src|drizzle|\.github)\/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)`/g)) {
      const refPath = m[1];
      if (!fs.existsSync(path.join(repoRoot, refPath))) {
        errors.push(`Missing referenced repo file in ${rel}: ${refPath}`);
      }
    }
  }

  // 4. If embedded documentation-dist/ exists, verify base prefix & build info
  const embeddedDist = path.join(repoRoot, "documentation-dist");
  if (fs.existsSync(embeddedDist)) {
    const distIndex = path.join(embeddedDist, "index.html");
    const distInfo = path.join(embeddedDist, ".build-info.json");
    if (!fs.existsSync(distIndex) || !fs.existsSync(distInfo)) {
      errors.push("documentation-dist/ is incomplete (missing index.html or .build-info.json). Run npm run docs:build.");
    } else {
      try {
        const info = JSON.parse(fs.readFileSync(distInfo, "utf8"));
        if (info.base !== "/documentation") {
          errors.push(`documentation-dist/.build-info.json has unexpected base '${info.base}' (expected '/documentation').`);
        }
      } catch {
        errors.push("documentation-dist/.build-info.json is not valid JSON.");
      }
      const indexHtml = fs.readFileSync(distIndex, "utf8");
      for (const m of indexHtml.matchAll(/\b(?:href|src)="(\/[^"]*)"/g)) {
        const target = m[1];
        if (target === "/" || target.startsWith("//")) continue;
        if (target !== "/documentation" && !target.startsWith("/documentation/")) {
          errors.push(`Embedded docs link/asset in documentation-dist/index.html missing '/documentation' base: ${target}`);
        }
      }
    }
  }

  errors.push(...checkVersionConsistency(repoRoot));
  errors.push(...checkReadme(repoRoot));

  return errors;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const errors = runDocsChecks();
  if (errors.length > 0) {
    console.error("docs:check failed:");
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log("docs:check passed: all generated files, coverage, frontmatter, scripts, and assets verified.");
}
