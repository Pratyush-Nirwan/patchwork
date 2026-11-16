import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkWebsiteIsolation } from "../scripts/check-website-isolation.mjs";
import { checkExportDrift, exportWebsiteData } from "../scripts/docs/export-data.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

describe("Website package isolation & export determinism", () => {
  it("passes website isolation and export drift checks on the repository", () => {
    expect(checkWebsiteIsolation(REPO_ROOT)).toEqual([]);
    expect(checkExportDrift(REPO_ROOT)).toEqual([]);
  });

  it("fails isolation check when a file in website/ imports outside website/ or src/ imports website/", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pw-iso-"));
    try {
      fs.mkdirSync(path.join(tmp, "website/src"), { recursive: true });
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "website/package.json"), JSON.stringify({ name: "@patchwork/website" }));
      fs.writeFileSync(
        path.join(tmp, "website/src/bad.ts"),
        'import pkg from "../../package.json";\nexport default pkg;\n'
      );
      fs.writeFileSync(
        path.join(tmp, "src/bad.ts"),
        'import x from "../website/src/data/generated/app-meta.json";\nexport default x;\n'
      );
      const errs = checkWebsiteIsolation(tmp);
      expect(errs.some((e) => e.includes("escapes website/"))).toBe(true);
      expect(errs.some((e) => e.includes("app source imports from website/"))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("produces deterministic snapshots across repeated exports", () => {
    const tmp1 = fs.mkdtempSync(path.join(os.tmpdir(), "pw-exp1-"));
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "pw-exp2-"));
    try {
      const f1 = exportWebsiteData(REPO_ROOT, tmp1);
      const f2 = exportWebsiteData(REPO_ROOT, tmp2);
      expect(f1).toEqual(f2);
      for (const f of f1) {
        expect(fs.readFileSync(path.join(tmp1, f), "utf8")).toBe(
          fs.readFileSync(path.join(tmp2, f), "utf8")
        );
      }
    } finally {
      fs.rmSync(tmp1, { recursive: true, force: true });
      fs.rmSync(tmp2, { recursive: true, force: true });
    }
  });
});
