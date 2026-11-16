import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { findRepoRoot } from "../scripts/docs/extract.mjs";
import { exportWebsiteData } from "../scripts/docs/export-data.mjs";
import { checkCoverage } from "../website/scripts/coverage.mjs";
import { runDocsChecks } from "../scripts/docs/check.mjs";

describe("Documentation Enforcement & Coverage", () => {
  it("passes docs:check on the real repository", () => {
    const repoRoot = findRepoRoot();
    const errors = runDocsChecks(repoRoot);
    expect(errors).toEqual([]);
  });

  it("fails coverage check when an undocumented command is added to a fixture registry", () => {
    const repoRoot = findRepoRoot();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "patchwork-docs-neg-"));
    try {
      // Mirror minimal files needed by extract.mjs & exportWebsiteData
      for (const rel of [
        "package.json",
        "CHANGELOG.md",
        ".env.example",
        "src/lib/shortcuts.ts",
        "src/lib/rbac.ts",
        "src/lib/settings.ts",
        "src/db/schema.ts",
        "scripts/setup.mjs",
      ]) {
        const dst = path.join(tmpRoot, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(repoRoot, rel), dst);
      }

      // Copy API route group directories
      const apiSrc = path.join(repoRoot, "src/app/api");
      for (const entry of fs.readdirSync(apiSrc, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          fs.mkdirSync(path.join(tmpRoot, "src/app/api", entry.name), { recursive: true });
        }
      }

      // Copy committed reference docs
      const refSrc = path.join(repoRoot, "website/src/content/docs/documentation/reference");
      const refDst = path.join(tmpRoot, "website/src/content/docs/documentation/reference");
      fs.mkdirSync(refDst, { recursive: true });
      for (const file of fs.readdirSync(refSrc)) {
        fs.copyFileSync(path.join(refSrc, file), path.join(refDst, file));
      }

      // Inject an undocumented fake command into fixture registry.ts
      const regSrc = fs.readFileSync(path.join(repoRoot, "src/lib/commands/registry.ts"), "utf8");
      const fakeCmd = `
  {
    name: "fake-undocumented-cmd",
    category: "Tickets",
    description: "Fake command for negative enforcement test",
    examples: ["/fake-undocumented-cmd"],
    args: [],
    minRole: "member",
  },
];`;
      const regMutated = regSrc.replace(/\n\];\s*\n\s*export const COMMAND_REGISTRY/, `\n${fakeCmd}\n\nexport const COMMAND_REGISTRY`);
      expect(regMutated).toContain("fake-undocumented-cmd");

      const regDst = path.join(tmpRoot, "src/lib/commands/registry.ts");
      fs.mkdirSync(path.dirname(regDst), { recursive: true });
      fs.writeFileSync(regDst, regMutated, "utf8");

      exportWebsiteData(tmpRoot, path.join(tmpRoot, "website/src/data/generated"));
      const errors = checkCoverage(path.join(tmpRoot, "website"), refDst);
      expect(errors.some((e) => e.includes("/fake-undocumented-cmd"))).toBe(true);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
