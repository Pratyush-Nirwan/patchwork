import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEBSITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not locate npm-cli.js (checked: ${candidates.join(", ")})`);
}

function runNpmScript(script) {
  const npmCli = resolveNpmCli();
  execFileSync(process.execPath, [npmCli, "run", script], {
    cwd: WEBSITE_ROOT,
    stdio: "inherit",
    shell: false,
  });
}

for (const script of [
  "generate",
  "check",
  "lint",
  "typecheck",
  "test",
  "build:website",
  "build:embedded",
]) {
  runNpmScript(script);
}
console.log("website verify passed.");
