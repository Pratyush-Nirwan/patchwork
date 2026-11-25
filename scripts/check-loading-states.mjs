#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const targetIdx = args.indexOf("--target");
const allowlistIdx = args.indexOf("--allowlist");

const rootDir = targetIdx !== -1 && args[targetIdx + 1]
  ? path.resolve(args[targetIdx + 1])
  : process.cwd();
const allowlistPath = allowlistIdx !== -1 && args[allowlistIdx + 1]
  ? path.resolve(args[allowlistIdx + 1])
  : path.join(rootDir, "loading-allowlist.yaml");

function parseAllowlist(filePath) {
  const entries = [];
  if (!fs.existsSync(filePath)) return entries;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line === "entries:") continue;
    if (line.startsWith("- file:")) {
      if (current) entries.push(current);
      current = { file: line.slice(7).trim().replace(/^["']|["']$/g, ""), rule: "" };
    } else if (current && line.startsWith("rule:")) {
      current.rule = line.slice(5).trim().replace(/^["']|["']$/g, "");
    }
  }
  if (current) entries.push(current);
  return entries;
}

const allowlist = parseAllowlist(allowlistPath);
const isAllowed = (relFile, rule) => {
  const norm = relFile.replace(/\\/g, "/");
  return allowlist.some((e) => e.file === norm && e.rule === rule);
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", "dist", ".git", "generated"].includes(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (/\.(tsx|jsx|ts|astro)$/.test(ent.name)) out.push(full);
  }
  return out;
}

const scanRoots = fs.existsSync(path.join(rootDir, "src"))
  ? [path.join(rootDir, "src"), path.join(rootDir, "website", "src")].filter((d) => fs.existsSync(d))
  : [rootDir];

const files = scanRoots.flatMap((r) => walk(r));
const violations = [];

const jsxLoadingTextRe = />\s*(Loading|Initiali[sz]ing|Please wait|Fetching|Checking|Connecting|Preparing|Searching|Syncing)([^<{]*?(\.\.\.|…)|[^<{]{0,40})\s*</i;
const ternaryLoadingLiteralRe = /\?\s*["'](Loading|Initiali[sz]ing|Please wait|Fetching|Checking|Connecting|Preparing|Searching|Syncing)(\.\.\.|…)?["']/i;
const spinnerRe = /<(Loader2?|Spinner|CircularProgress)\b|\banimate-spin\b/;
const fallbackNullRe = /fallback=\{\s*null\s*\}/;
const nullLoadingReturnRe = /if\s*\([^)]*\b(isLoading|loading|isFetching|isPending)\b[^)]*\)\s*return\s+null\b/;
const hardcodedSkColorRe = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\bbg-(?:gray|slate|zinc|neutral|stone)-\d{2,3}\b)/;

for (const abs of files) {
  const rel = path.relative(rootDir, abs).replace(/\\/g, "/");
  const content = fs.readFileSync(abs, "utf8");
  const lines = content.split(/\r?\n/);

  const isSkeletonFile =
    rel.includes("components/skeletons/") || rel.endsWith("components/ui/skeleton.tsx");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    if (
      (jsxLoadingTextRe.test(line) || ternaryLoadingLiteralRe.test(line)) &&
      !isAllowed(rel, "loading-text")
    ) {
      violations.push({
        file: rel,
        line: i + 1,
        rule: "loading-text",
        message: `Forbidden loading text literal: ${trimmed.slice(0, 100)}`,
      });
    }

    if (spinnerRe.test(line) && !isAllowed(rel, "spinner")) {
      violations.push({
        file: rel,
        line: i + 1,
        rule: "spinner",
        message: `Forbidden spinner / animate-spin outside allowlisted button: ${trimmed.slice(0, 100)}`,
      });
    }

    if (fallbackNullRe.test(line) && !isAllowed(rel, "fallback-null")) {
      violations.push({
        file: rel,
        line: i + 1,
        rule: "fallback-null",
        message: "Forbidden fallback={null} on Suspense boundary; use a geometry-matched skeleton.",
      });
    }

    if (nullLoadingReturnRe.test(line) && !isAllowed(rel, "null-loading-return")) {
      violations.push({
        file: rel,
        line: i + 1,
        rule: "null-loading-return",
        message: "Forbidden return null in loading branch; use a skeleton or SkeletonRegion.",
      });
    }

    if (isSkeletonFile && hardcodedSkColorRe.test(line) && !isAllowed(rel, "hardcoded-skeleton-color")) {
      violations.push({
        file: rel,
        line: i + 1,
        rule: "hardcoded-skeleton-color",
        message: `Hardcoded color in skeleton component: ${trimmed.slice(0, 100)}`,
      });
    }
  }

  // Check route segments (page.tsx) have sibling loading.tsx
  if (/(^|\/)app\/.*page\.tsx$/.test(rel) || rel === "src/app/page.tsx") {
    const loadingSibling = path.join(path.dirname(abs), "loading.tsx");
    if (!fs.existsSync(loadingSibling) && !isAllowed(rel, "missing-loading-route")) {
      violations.push({
        file: rel,
        line: 1,
        rule: "missing-loading-route",
        message: "Route segment is missing a sibling loading.tsx skeleton.",
      });
    }
  }
}

if (violations.length > 0) {
  console.error(`check-loading-states failed with ${violations.length} violation(s):`);
  for (const v of violations) {
    console.error(`  [${v.rule}] ${v.file}:${v.line} — ${v.message}`);
  }
  process.exit(1);
}

console.log(`check-loading-states passed (${files.length} files scanned, ${allowlist.length} allowlisted).`);
