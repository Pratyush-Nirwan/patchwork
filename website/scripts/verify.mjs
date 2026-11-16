import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEBSITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runNpmScript(script) {
  const npmCli = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
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
