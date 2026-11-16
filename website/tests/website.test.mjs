import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { WEBSITE_ROOT, getPackageMeta } from "../scripts/lib/meta.mjs";
import { checkAssetBudgets, checkFeaturesYaml, runWebsiteChecks } from "../scripts/check.mjs";
import { checkChangelog } from "../scripts/changelog.mjs";
import { loadRoadmap, validateRoadmap } from "../scripts/roadmap.mjs";

test("website checks pass cleanly", () => {
  assert.deepEqual(runWebsiteChecks(WEBSITE_ROOT), []);
});

test("features.yaml code signals and asset budgets pass", () => {
  assert.deepEqual(checkFeaturesYaml(WEBSITE_ROOT), []);
  assert.deepEqual(checkAssetBudgets(WEBSITE_ROOT), []);
});

test("roadmap and changelog validate against app-meta.json", () => {
  const meta = getPackageMeta(WEBSITE_ROOT);
  const roadmap = loadRoadmap(WEBSITE_ROOT);
  assert.deepEqual(validateRoadmap(roadmap, meta.displayVersion), []);
  assert.deepEqual(checkChangelog(WEBSITE_ROOT), []);
});

test("no file in website/ escapes package root via relative imports", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(WEBSITE_ROOT, "package.json"), "utf8"));
  for (const sec of ["dependencies", "devDependencies"]) {
    for (const ver of Object.values(pkg[sec] || {})) {
      assert.equal(String(ver).startsWith("workspace:"), false);
      assert.equal(String(ver).startsWith("file:.."), false);
    }
  }
});
