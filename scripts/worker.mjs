#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(repoRoot, ".env") });

const outFile = path.join(repoRoot, ".next", "patchwork-worker.cjs");
const entryFile = path.join(repoRoot, "src", "lib", "worker-cli.ts");

async function ensureBundle() {
  const esbuild = await import("esbuild");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await esbuild.build({
    entryPoints: [entryFile],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    packages: "external",
    alias: {
      "@": path.join(repoRoot, "src"),
    },
    sourcemap: false,
    logLevel: "silent",
  });
}

await ensureBundle();
const require = createRequire(pathToFileURL(outFile).href);
require(outFile);
