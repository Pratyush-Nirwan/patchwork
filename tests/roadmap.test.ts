import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkPlannedCodeSignals,
  extractLiveCodeSnapshot,
  loadRoadmap,
  parseRoadmapYaml,
  validateRoadmap,
} from "../website/scripts/roadmap.mjs";
import { runDocsChecks } from "../scripts/docs/check.mjs";
import { checkReadme } from "../scripts/docs/readme-check.mjs";
import { checkVersionConsistency } from "../scripts/check-version.mjs";
import { getVersionInfo } from "../scripts/lib/version.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const WEBSITE_ROOT = path.join(REPO_ROOT, "website");

describe("v1.0.0 Roadmap schema, generation, and guardrails", () => {
  it("validates website/src/data/roadmap.yaml against current version and live code signals", () => {
    const versionInfo = getVersionInfo(REPO_ROOT);
    const roadmap = loadRoadmap(WEBSITE_ROOT);
    expect(validateRoadmap(roadmap, versionInfo.displayVersion)).toEqual([]);
    expect(checkPlannedCodeSignals(roadmap, extractLiveCodeSnapshot(WEBSITE_ROOT))).toEqual([]);
  });

  it("rejects invalid status, duplicate id, unknown dependsOn, and shippedIn on non-shipped items", () => {
    const valid = loadRoadmap(WEBSITE_ROOT);

    const badStatus = structuredClone(valid);
    badStatus.items[0].status = "soon";
    expect(validateRoadmap(badStatus).some((e) => e.includes("invalid status"))).toBe(true);

    const dupId = structuredClone(valid);
    dupId.items.push({ ...structuredClone(valid.items[0]) });
    expect(validateRoadmap(dupId).some((e) => e.includes("Duplicate roadmap item id"))).toBe(true);

    const badDep = structuredClone(valid);
    badDep.items[0].dependsOn = ["nonexistent-id"];
    expect(validateRoadmap(badDep).some((e) => e.includes("unknown dependsOn"))).toBe(true);

    const badShippedIn = structuredClone(valid);
    badShippedIn.items[0].shippedIn = "v0.7.0-beta";
    expect(validateRoadmap(badShippedIn).some((e) => e.includes("must not set shippedIn"))).toBe(true);
  });

  it("fails guardrail when a planned item has a matching live code signal", () => {
    const sample = parseRoadmapYaml(`
currentVersion: "v0.7.0-beta"
targetVersion: "v1.0.0"
categories:
  - id: "cat"
    title: "Cat"
items:
  - id: "fake-planned"
    title: "Fake planned"
    category: "cat"
    summary: "Planned item."
    status: "planned"
    target: "v1.0.0"
    shippedIn: ""
    dependsOn: []
    codeSignals:
      commands: ["new"]
`);
    const errs = checkPlannedCodeSignals(sample, extractLiveCodeSnapshot(WEBSITE_ROOT));
    expect(errs.some((e) => e.includes('matches live code commands signal "new"'))).toBe(true);
  });

  it("keeps planned items out of generated reference pages and README Features", () => {
    const roadmap = loadRoadmap(WEBSITE_ROOT);
    const refDir = path.join(WEBSITE_ROOT, "src/content/docs/documentation/reference");
    for (const file of fs.readdirSync(refDir).filter((f) => f.endsWith(".mdx"))) {
      const text = fs.readFileSync(path.join(refDir, file), "utf8").toLowerCase();
      for (const item of roadmap.items) {
        if (item.status === "planned") {
          expect(text).not.toContain(item.title.toLowerCase());
        }
      }
    }

    const readme = fs.readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
    const statusIdx = readme.indexOf("## Status & Roadmap");
    const beforeRoadmap = statusIdx === -1 ? readme : readme.slice(0, statusIdx);
    for (const term of ["sprints", "subtasks", "audit log", "inbound webhooks", "passkeys", "2FA"]) {
      expect(beforeRoadmap.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });

  it("fails readme:check if a planned term appears in a present-tense section", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pw-readme-guard-"));
    try {
      for (const item of ["package.json", "docs", "website/src", "README.md"]) {
        const src = path.join(REPO_ROOT, item);
        const dst = path.join(tmp, item);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        if (fs.statSync(src).isDirectory()) {
          fs.cpSync(src, dst, { recursive: true });
        } else {
          fs.copyFileSync(src, dst);
        }
      }
      // Inject a planned term ("sprints") into README.md before ## Status & Roadmap
      const readmePath = path.join(tmp, "README.md");
      const orig = fs.readFileSync(readmePath, "utf8");
      const injected = orig.replace(
        "## Features\n",
        "## Features\n\n- Built-in sprints support.\n"
      );
      fs.writeFileSync(readmePath, injected, "utf8");
      const errs = checkReadme(tmp, { runMarkdownLint: false });
      expect(errs.some((e) => e.includes('prohibited v1 term "sprints"'))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("passes docs:check, readme:check, and version:check on the repository", () => {
    expect(runDocsChecks(REPO_ROOT)).toEqual([]);
    expect(checkReadme(REPO_ROOT, { runMarkdownLint: false })).toEqual([]);
    expect(checkVersionConsistency(REPO_ROOT)).toEqual([]);
  });
});
