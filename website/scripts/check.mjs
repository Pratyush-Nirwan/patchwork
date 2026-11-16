import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WEBSITE_ROOT, getPackageMeta, loadGeneratedJson, isValidSemver } from "./lib/meta.mjs";
import { generateReferenceDocs } from "./generate.mjs";
import { checkCoverage } from "./coverage.mjs";
import {
  loadRoadmap,
  validateRoadmap,
  extractLiveCodeSnapshot,
  checkPlannedCodeSignals,
  renderRoadmapPage,
  renderLandingStrip,
  renderGuideAdmonition,
} from "./roadmap.mjs";
import { checkChangelog } from "./changelog.mjs";

const MAX_IMAGE_BYTES = 300 * 1024;
const MAX_VIDEO_BYTES = 1200 * 1024;
const IMAGE_EXTS = new Set([".png", ".webp", ".avif", ".jpg", ".jpeg"]);
const VIDEO_EXTS = new Set([".webm", ".mp4"]);

const PROHIBITED_PLANNED_TERMS = [
  "email notifications",
  "in-app notifications",
  "audit log",
  "API tokens",
  "personal access token",
  "SSO",
  "sprints",
  "subtasks",
  "passkeys",
  "2FA",
  "email-to-ticket",
];

function collectFiles(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, exts, out);
    else if (exts.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

export function checkFeaturesYaml(websiteRoot = WEBSITE_ROOT) {
  const errors = [];
  const yamlPath = path.join(websiteRoot, "src/data/features.yaml");
  if (!fs.existsSync(yamlPath)) return ["Missing src/data/features.yaml"];

  const snap = extractLiveCodeSnapshot(websiteRoot);
  const flags = new Set((loadGeneratedJson("installer-flags.json", websiteRoot).flags || []).map((f) => f.primaryFlag));
  const raw = fs.readFileSync(yamlPath, "utf8");
  for (const m of raw.matchAll(/codeSignal:\s*"([^"]+)"/g)) {
    const [kind, val] = m[1].split(":");
    const ok =
      (kind === "table" && snap.tables.has(val)) ||
      (kind === "command" && snap.commands.has(val)) ||
      (kind === "route" && snap.routes.has(val)) ||
      (kind === "permission" && snap.permissions.has(val)) ||
      (kind === "flag" && flags.has(val));
    if (!ok) {
      errors.push(`features.yaml codeSignal "${m[1]}" did not match any snapshot in src/data/generated/`);
    }
  }
  return errors;
}

export function checkAssetBudgets(websiteRoot = WEBSITE_ROOT) {
  const errors = [];
  const assetsDir = path.join(websiteRoot, "src/assets");
  if (!fs.existsSync(assetsDir)) return errors;
  for (const file of collectFiles(assetsDir, new Set([...IMAGE_EXTS, ...VIDEO_EXTS]))) {
    const ext = path.extname(file);
    const size = fs.statSync(file).size;
    const rel = path.relative(websiteRoot, file).replace(/\\/g, "/");
    if (IMAGE_EXTS.has(ext) && size > MAX_IMAGE_BYTES) {
      errors.push(`Image asset ${rel} exceeds 300 KB budget (${Math.round(size / 1024)} KB).`);
    }
    if (VIDEO_EXTS.has(ext) && size > MAX_VIDEO_BYTES) {
      errors.push(`Video asset ${rel} exceeds 1.2 MB budget (${Math.round(size / 1024)} KB).`);
    }
  }
  return errors;
}

export function runWebsiteChecks(websiteRoot = WEBSITE_ROOT) {
  const errors = [];
  const meta = getPackageMeta(websiteRoot);
  const docsContentDir = path.join(websiteRoot, "src/content/docs/documentation");
  const committedRefDir = path.join(docsContentDir, "reference");

  // 1. Version consistency inside website/
  const webPkg = JSON.parse(fs.readFileSync(path.join(websiteRoot, "package.json"), "utf8"));
  if (!isValidSemver(webPkg.version) || webPkg.version !== meta.version) {
    errors.push(`website/package.json version "${webPkg.version}" != app-meta.json "${meta.version}".`);
  }

  // 2. Reference freshness
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-web-check-"));
  try {
    for (const file of generateReferenceDocs(websiteRoot, tmpDir)) {
      const committedPath = path.join(committedRefDir, file);
      if (!fs.existsSync(committedPath)) {
        errors.push(`Missing reference/${file}. Run npm run generate.`);
      } else if (
        fs.readFileSync(committedPath, "utf8").replace(/\r\n/g, "\n") !==
        fs.readFileSync(path.join(tmpDir, file), "utf8").replace(/\r\n/g, "\n")
      ) {
        errors.push(`Out-of-date reference/${file}. Run npm run generate.`);
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 3. Coverage
  errors.push(...checkCoverage(websiteRoot, committedRefDir));

  // 4. Docs frontmatter & screenshot references
  const mdFiles = collectFiles(docsContentDir, new Set([".md", ".mdx"]));
  for (const file of mdFiles) {
    const rel = path.relative(websiteRoot, file).replace(/\\/g, "/");
    const content = fs.readFileSync(file, "utf8");
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) errors.push(`Missing YAML frontmatter in ${rel}`);
    else {
      if (!/^title:\s*.+/m.test(fmMatch[1])) errors.push(`Missing frontmatter title in ${rel}`);
      if (!/^description:\s*.+/m.test(fmMatch[1])) errors.push(`Missing frontmatter description in ${rel}`);
    }
    for (const m of content.matchAll(/!\[[^\]]*\]\(([^)]*screenshots\/[^)]+)\)/g)) {
      const imgRel = m[1].split("#")[0].split("?")[0];
      const resolved = path.resolve(path.dirname(file), imgRel);
      if (!fs.existsSync(resolved)) errors.push(`Missing screenshot in ${rel}: ${imgRel}`);
    }
  }

  // 5. Asset budgets & features.yaml
  errors.push(...checkAssetBudgets(websiteRoot));
  errors.push(...checkFeaturesYaml(websiteRoot));

  // 6. Roadmap & Changelog
  try {
    const roadmap = loadRoadmap(websiteRoot);
    errors.push(...validateRoadmap(roadmap, meta.displayVersion));
    errors.push(...checkPlannedCodeSignals(roadmap, extractLiveCodeSnapshot(websiteRoot)));

    const roadmapMdx = fs.readFileSync(path.join(docsContentDir, "project/roadmap.mdx"), "utf8").replace(/\r\n/g, "\n");
    if (roadmapMdx !== renderRoadmapPage(roadmap, meta).replace(/\r\n/g, "\n")) {
      errors.push("project/roadmap.mdx is out of date. Run npm run generate.");
    }
    const indexMdx = fs.readFileSync(path.join(docsContentDir, "index.mdx"), "utf8").replace(/\r\n/g, "\n");
    if (!indexMdx.includes(renderLandingStrip(roadmap))) {
      errors.push("documentation/index.mdx roadmap strip is out of date. Run npm run generate.");
    }
    for (const file of mdFiles) {
      const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      const m = text.match(/\{\/\* ROADMAP_ADMONITION_START:([a-z0-9,-]+) \*\/\}/);
      if (m) {
        const expectedBlock = renderGuideAdmonition(roadmap, m[1].split(",").filter(Boolean), meta);
        if (!text.includes(expectedBlock)) {
          errors.push(`Roadmap admonition out of date in ${path.relative(websiteRoot, file)}. Run npm run generate.`);
        }
      }
    }
  } catch (err) {
    errors.push(`Roadmap check failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  errors.push(...checkChangelog(websiteRoot));

  // 7. Marketing pages: prohibit planned terms outside labeled Roadmap teaser blocks
  const pagesDir = path.join(websiteRoot, "src/pages");
  for (const file of collectFiles(pagesDir, new Set([".astro"]))) {
    const rel = path.relative(websiteRoot, file).replace(/\\/g, "/");
    const text = fs
      .readFileSync(file, "utf8")
      .replace(/<!--\s*ROADMAP_TEASER_START\s*-->[\s\S]*?<!--\s*ROADMAP_TEASER_END\s*-->/g, "");
    for (const term of PROHIBITED_PLANNED_TERMS) {
      const re = new RegExp(`\\b${term.replace(/\s+/g, "\\s+")}\\b`, "i");
      if (re.test(text)) {
        errors.push(`Marketing page ${rel} mentions planned term "${term}" outside Roadmap teaser.`);
      }
    }
  }

  return errors;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const errs = runWebsiteChecks();
  if (errs.length > 0) {
    console.error("website:check failed:");
    for (const e of errs) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log("website:check passed.");
}
