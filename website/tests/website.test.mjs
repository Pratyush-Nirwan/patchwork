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

test("per-section Open Graph images exist in public/ and stay under 300 KB", () => {
  const publicDir = path.join(WEBSITE_ROOT, "public");
  for (const file of ["og-image.png", "og-features.png", "og-get-started.png", "og-docs.png", "og-changelog.png"]) {
    const full = path.join(publicDir, file);
    assert.equal(fs.existsSync(full), true, `Missing OG image: ${file}`);
    const size = fs.statSync(full).size;
    assert.equal(size > 0 && size <= 300 * 1024, true, `OG image ${file} size out of budget: ${size}`);
  }
});

test("built website HTML includes SEO, Open Graph, JSON-LD, sitemap, robots.txt, and 404 noindex", () => {
  const distDir = path.join(WEBSITE_ROOT, "dist");
  if (!fs.existsSync(path.join(distDir, "index.html"))) return;

  const checks = [
    { rel: "index.html", og: "og-image.png" },
    { rel: "features/index.html", og: "og-features.png" },
    { rel: "get-started/index.html", og: "og-get-started.png" },
    { rel: "license/index.html", og: "og-image.png" },
    { rel: "security/index.html", og: "og-image.png" },
    { rel: "documentation/index.html", og: "og-docs.png" },
    { rel: "documentation/changelog/index.html", og: "og-changelog.png" },
  ];

  const isEmbedded = /<meta[^>]+name="robots"[^>]+content="noindex"/i.test(
    fs.readFileSync(path.join(distDir, "documentation/index.html"), "utf8")
  );

  for (const item of checks) {
    const html = fs.readFileSync(path.join(distDir, item.rel), "utf8");
    assert.match(html, /<html[^>]+lang="en"/i, `${item.rel} missing html[lang]`);
    assert.match(html, /<title>[^<]+<\/title>/i, `${item.rel} missing <title>`);
    assert.match(html, /<meta[^>]+name="description"[^>]+content="[^"]+"/i, `${item.rel} missing description`);
    assert.match(html, /<meta[^>]+property="og:site_name"[^>]+content="Patchwork"/i, `${item.rel} missing og:site_name`);
    assert.match(html, /<meta[^>]+property="og:title"[^>]+>/i, `${item.rel} missing og:title`);
    assert.match(html, /<meta[^>]+property="og:description"[^>]+>/i, `${item.rel} missing og:description`);
    assert.match(html, /<meta[^>]+property="og:image"[^>]+>/i, `${item.rel} missing og:image`);
    assert.match(html, /<meta[^>]+property="og:image:width"[^>]+content="1200"/i, `${item.rel} missing og:image:width`);
    assert.match(html, /<meta[^>]+property="og:image:height"[^>]+content="630"/i, `${item.rel} missing og:image:height`);
    assert.match(html, /<meta[^>]+property="og:image:alt"[^>]+>/i, `${item.rel} missing og:image:alt`);
    assert.match(html, new RegExp(item.og), `${item.rel} missing expected ${item.og}`);
    assert.match(html, /<meta[^>]+name="twitter:card"[^>]+summary_large_image/i, `${item.rel} missing twitter:card`);
    assert.match(html, /<meta[^>]+name="twitter:title"[^>]+>/i, `${item.rel} missing twitter:title`);
    assert.match(html, /<meta[^>]+name="twitter:description"[^>]+>/i, `${item.rel} missing twitter:description`);
    assert.match(html, /<meta[^>]+name="twitter:image"[^>]+>/i, `${item.rel} missing twitter:image`);

    if (!isEmbedded || !item.rel.startsWith("documentation/")) {
      assert.match(html, /<link[^>]+rel="canonical"[^>]+href="https?:\/\//i, `${item.rel} missing canonical URL`);
      const ldMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
      assert.ok(ldMatch, `${item.rel} missing JSON-LD`);
      assert.doesNotThrow(() => JSON.parse(ldMatch[1]), `${item.rel} invalid JSON-LD`);
    }
  }

  const robots = fs.readFileSync(path.join(distDir, "robots.txt"), "utf8");
  if (!isEmbedded) {
    assert.match(robots, /Allow:\s*\//i, "robots.txt missing Allow: /");
    assert.match(robots, /Sitemap:\s*https?:\/\/.+\/sitemap-index\.xml/i, "robots.txt missing Sitemap URL");
    assert.equal(fs.existsSync(path.join(distDir, "sitemap-index.xml")), true, "missing sitemap-index.xml");
  }

  const notFound = fs.readFileSync(path.join(distDir, "404.html"), "utf8");
  assert.match(notFound, /<meta[^>]+name="robots"[^>]+noindex/i, "404.html missing noindex");
});
