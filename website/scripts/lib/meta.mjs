import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WEBSITE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

export function getPackageMeta(websiteRoot = WEBSITE_ROOT) {
  const metaPath = path.join(websiteRoot, "src/data/generated/app-meta.json");
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Missing ${metaPath}. Run 'npm run docs:export' from repository root.`);
  }
  return JSON.parse(fs.readFileSync(metaPath, "utf8"));
}

export function loadGeneratedJson(name, websiteRoot = WEBSITE_ROOT) {
  const full = path.join(websiteRoot, "src/data/generated", name);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing ${full}. Run 'npm run docs:export' from repository root.`);
  }
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

export function isValidSemver(version) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
    String(version || "").trim()
  );
}
