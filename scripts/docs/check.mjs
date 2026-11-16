import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findRepoRoot } from "./extract.mjs";
import { checkExportDrift } from "./export-data.mjs";
import { checkWebsiteIsolation } from "../check-website-isolation.mjs";
import { checkVersionConsistency } from "../check-version.mjs";
import { checkReadme } from "./readme-check.mjs";
import { runWebsiteChecks } from "../../website/scripts/check.mjs";

export function runDocsChecks(repoRoot = findRepoRoot()) {
  const errors = [];
  const websiteRoot = path.join(repoRoot, "website");

  errors.push(...checkExportDrift(repoRoot));
  errors.push(...checkWebsiteIsolation(repoRoot));
  errors.push(...runWebsiteChecks(websiteRoot));

  // Verify embedded documentation-dist/ when built
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
  console.log("docs:check passed: export drift, isolation, website checks, version, and README verified.");
}
