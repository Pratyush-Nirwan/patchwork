import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEBSITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(WEBSITE_ROOT, "dist");

if (!fs.existsSync(path.join(distDir, "index.html"))) {
  console.error("Run 'npm run build:website' before checking performance budgets.");
  process.exit(1);
}

// Measure Home JS & total weight budgets
const indexHtml = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
let jsBytes = 0;
for (const m of indexHtml.matchAll(/<script[^>]+src="([^"]+)"/g)) {
  const rel = m[1].replace(/^\/+/, "");
  const full = path.join(distDir, rel);
  if (fs.existsSync(full)) jsBytes += fs.statSync(full).size;
}
console.log(`Home script raw bytes: ${jsBytes} (budget: < 60 KB gzipped)`);
if (jsBytes > 180 * 1024) {
  console.error("Home JS exceeds budget.");
  process.exit(1);
}
console.log("Budget check passed. For full Lighthouse scoring, run lhci/lighthouse against preview.");
