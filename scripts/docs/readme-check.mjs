import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_REPO_ROOT, getVersionInfo } from "../lib/version.mjs";
import { npmBin } from "../lib/platform.mjs";
import { renderReadme } from "./readme.mjs";

const MAX_README_LINES = 250;
const MAX_IMAGE_BYTES = 300 * 1024;
const ALLOWED_EXTERNAL_COMMANDS = new Set([
  "git",
  "cd",
  "New-Item",
  "Invoke-WebRequest",
  "mkdir",
  "curl",
  "chmod",
]);
const PROHIBITED_AS_FEATURE = [
  "Docker",
  "webhooks",
  "email notifications",
  "in-app notifications",
  "audit log",
  "API tokens",
  "SSO",
];

function slugifyHeading(text) {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s/g, "-");
}

export function checkReadme(
  repoRoot = DEFAULT_REPO_ROOT,
  { runMarkdownLint = true } = {}
) {
  const errors = [];
  const readmePath = path.join(repoRoot, "README.md");
  if (!fs.existsSync(readmePath)) {
    return ["README.md is missing."];
  }

  const content = fs.readFileSync(readmePath, "utf8").replace(/\r\n/g, "\n");

  // 1. Matches generated output
  const expected = renderReadme(repoRoot);
  if (content !== expected) {
    errors.push("README.md is out of sync with docs/README.template.md. Run `npm run readme:generate`.");
  }

  // 2. Line budget
  const lines = content.split("\n");
  if (lines.length > MAX_README_LINES) {
    errors.push(`README.md has ${lines.length} lines (limit ${MAX_README_LINES}).`);
  }

  // 3. Version & badge check
  const { displayVersion } = getVersionInfo(repoRoot);
  const badgeVer = displayVersion.replace(/-/g, "--");
  if (!content.includes(displayVersion) || !content.includes(badgeVer)) {
    errors.push(`README.md missing expected version ${displayVersion} or badge ${badgeVer}.`);
  }

  // 4. Collect headings for anchor verification
  const anchors = new Set();
  for (const line of lines) {
    const m = line.match(/^#{1,6}\s+(.+)$/);
    if (m) anchors.add(slugifyHeading(m[1]));
  }

  // 5. Verify markdown links and local paths/anchors
  for (const m of content.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    const target = m[2];
    if (/^https?:\/\//i.test(target) || target.startsWith("mailto:")) continue;
    if (target.startsWith("#")) {
      if (!anchors.has(target.slice(1))) {
        errors.push(`Broken README anchor link: ${target}`);
      }
      continue;
    }
    const cleanPath = target.split("#")[0];
    if (cleanPath && !fs.existsSync(path.join(repoRoot, cleanPath))) {
      errors.push(`Broken README relative link: ${target}`);
    }
  }

  // 6. Verify <img> and <source srcset> assets: exist, size <= 300KB, alt text present
  for (const m of content.matchAll(/<img\b([^>]*)>/g)) {
    const attrs = m[1];
    const srcMatch = attrs.match(/\bsrc="([^"]+)"/);
    const altMatch = attrs.match(/\balt="([^"]*)"/);
    if (!altMatch || !altMatch[1].trim()) {
      errors.push(`README <img> tag missing non-empty alt text: ${m[0]}`);
    }
    if (srcMatch) {
      const imgPath = path.join(repoRoot, srcMatch[1]);
      if (!fs.existsSync(imgPath)) {
        errors.push(`Missing README image asset: ${srcMatch[1]}`);
      } else if (fs.statSync(imgPath).size > MAX_IMAGE_BYTES) {
        errors.push(`README image exceeds 300 KB: ${srcMatch[1]}`);
      }
    }
  }
  for (const m of content.matchAll(/srcset="([^"]+)"/g)) {
    const assetPath = path.join(repoRoot, m[1]);
    if (!fs.existsSync(assetPath)) {
      errors.push(`Missing README <source> asset: ${m[1]}`);
    } else if (fs.statSync(assetPath).size > MAX_IMAGE_BYTES) {
      errors.push(`README <source> asset exceeds 300 KB: ${m[1]}`);
    }
  }

  // 7. Verify commands in fenced code blocks
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const scripts = new Set(Object.keys(pkg.scripts || {}));
  for (const block of content.matchAll(/```(?:bash|powershell|sh)\n([\s\S]*?)```/g)) {
    for (const rawLine of block[1].split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const npmRunMatch = line.match(/^npm\s+run\s+([a-zA-Z0-9:_-]+)/);
      if (npmRunMatch) {
        if (!scripts.has(npmRunMatch[1])) {
          errors.push(`README references nonexistent npm script: ${npmRunMatch[1]}`);
        }
        continue;
      }
      if (/^npm\s+(ci|install|test|start)\b/.test(line)) continue;
      const cmd = line.split(/\s+/)[0];
      if (!ALLOWED_EXTERNAL_COMMANDS.has(cmd)) {
        errors.push(`README references undocumented command: ${cmd}`);
      }
    }
  }

  // 8. Prohibited terms check outside Status & Roadmap and explicit "no Docker" disclaimers
  const statusIdx = content.indexOf("## Status & Roadmap");
  const featureBody = statusIdx === -1 ? content : content.slice(0, statusIdx);
  for (const line of featureBody.split("\n")) {
    if (/no\s+docker/i.test(line)) continue;
    for (const term of PROHIBITED_AS_FEATURE) {
      const re = new RegExp(`\\b${term.replace(/\s+/g, "\\s+")}\\b`, "i");
      if (re.test(line)) {
        errors.push(`README mentions prohibited v1 term "${term}" outside Status & Roadmap: ${line.trim()}`);
      }
    }
  }

  // 9. Markdown lint
  if (runMarkdownLint) {
    const npx = npmBin("npx");
    const useShell = npx.endsWith(".cmd");
    try {
      execFileSync(npx, ["markdownlint-cli2", "README.md"], {
        cwd: repoRoot,
        stdio: "pipe",
        shell: useShell,
      });
    } catch (err) {
      const out = err instanceof Error && "stdout" in err ? String(err.stdout || err.message) : String(err);
      errors.push(`markdownlint-cli2 failed:\n${out.trim()}`);
    }
  }

  return errors;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const errors = checkReadme();
  if (errors.length > 0) {
    console.error("readme:check failed:");
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log("readme:check passed.");
}
