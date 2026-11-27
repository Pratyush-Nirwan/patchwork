import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WEBSITE_ROOT, getPackageMeta, isValidSemver } from "./lib/meta.mjs";
import { loadRoadmap } from "./roadmap.mjs";

const GENERATED_HEADER =
  "{/* Generated file, do not edit. Run `npm run generate` to update. */}";

export const ALLOWED_CATEGORIES = [
  "Added",
  "Changed",
  "Deprecated",
  "Removed",
  "Fixed",
  "Security",
];

const CATEGORY_ICONS = {
  Added: "+",
  Changed: "~",
  Deprecated: "!",
  Removed: "-",
  Fixed: "*",
  Security: "#",
};

export function loadChangelogScopes(websiteRoot = WEBSITE_ROOT) {
  const scopesPath = path.join(websiteRoot, "src/data/changelog-scopes.yaml");
  const lines = fs.readFileSync(scopesPath, "utf8").replace(/\r\n/g, "\n").split("\n");
  const scopes = [];
  for (const line of lines) {
    const m = line.match(/^\s*-\s*"?([^"]+)"?\s*$/);
    if (m) scopes.push(m[1].trim());
  }
  if (scopes.length === 0) throw new Error("changelog-scopes.yaml defines no scopes.");
  return scopes;
}

function isValidIsoDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function compareSemverDesc(a, b) {
  const [coreA, preA = ""] = a.replace(/^v/, "").split("-");
  const [coreB, preB = ""] = b.replace(/^v/, "").split("-");
  const partsA = coreA.split(".").map(Number);
  const partsB = coreB.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (partsA[i] !== partsB[i]) return partsB[i] - partsA[i];
  }
  if (!preA && preB) return -1;
  if (preA && !preB) return 1;
  return preB.localeCompare(preA);
}

export function releaseSlug(version) {
  if (version.toLowerCase() === "unreleased") return "unreleased";
  return version.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function extractDocsLinks(text) {
  return [...text.matchAll(/\[docs\]\(([^)]+)\)/g)].map((m) => m[1]);
}

function docsRouteExists(websiteRoot, route) {
  if (!route.startsWith("/")) return false;
  let clean = route.split("#")[0].replace(/^\/+|\/+$/g, "");
  clean = clean.replace(/^documentation\/?/, "");
  const docsDir = path.join(websiteRoot, "src/content/docs/documentation");
  if (!clean) return fs.existsSync(path.join(docsDir, "index.mdx"));
  return (
    fs.existsSync(path.join(docsDir, `${clean}.mdx`)) ||
    fs.existsSync(path.join(docsDir, `${clean}.md`)) ||
    fs.existsSync(path.join(docsDir, clean, "index.mdx")) ||
    fs.existsSync(path.join(docsDir, clean, "index.md"))
  );
}

/**
 * @param {string} markdown
 * @param {{ scopes?: string[] }} [options]
 */
export function parseChangelog(markdown, { scopes = [] } = {}) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const releases = [];
  let currentRelease = null;
  let currentSection = null;
  const compareLinks = new Map();

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];

    const linkMatch = line.match(/^\[([^\]]+)\]:\s*(\S+)\s*$/);
    if (linkMatch) {
      compareLinks.set(linkMatch[1], linkMatch[2]);
      continue;
    }

    if (line.startsWith("## ")) {
      const unreleasedMatch = line.match(/^## \[Unreleased\]\s*$/);
      const releaseMatch = line.match(/^## \[([^\]]+)\]\s*-\s*(\S+)\s*$/);
      if (unreleasedMatch) {
        currentRelease = {
          version: "Unreleased",
          isUnreleased: true,
          date: null,
          line: lineNum,
          highlights: [],
          upgradeNotes: [],
          categories: new Map(),
        };
        releases.push(currentRelease);
        currentSection = null;
      } else if (releaseMatch) {
        currentRelease = {
          version: releaseMatch[1],
          isUnreleased: false,
          date: releaseMatch[2],
          line: lineNum,
          highlights: [],
          upgradeNotes: [],
          categories: new Map(),
        };
        releases.push(currentRelease);
        currentSection = null;
      } else {
        throw new Error(`CHANGELOG.md:${lineNum}: Malformed release header "${line}".`);
      }
      continue;
    }

    if (!currentRelease) continue;

    if (line.startsWith("### ")) {
      const heading = line.slice(4).trim();
      currentSection = { name: heading, line: lineNum };
      if (heading !== "Highlights" && heading !== "Upgrade notes") {
        if (!ALLOWED_CATEGORIES.includes(heading)) {
          throw new Error(`CHANGELOG.md:${lineNum}: Unknown category "### ${heading}".`);
        }
        if (!currentRelease.categories.has(heading)) {
          currentRelease.categories.set(heading, []);
        }
      }
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!currentSection) {
      throw new Error(`CHANGELOG.md:${lineNum}: Content outside a ### section.`);
    }

    if (currentSection.name === "Highlights") {
      const hm = trimmed.match(/^-\s+(.+)$/);
      if (!hm) throw new Error(`CHANGELOG.md:${lineNum}: Highlights must be bullets.`);
      currentRelease.highlights.push({ text: hm[1].trim(), line: lineNum });
      continue;
    }

    if (currentSection.name === "Upgrade notes") {
      const um = trimmed.match(/^\d+\.\s+(.+)$/);
      if (!um) throw new Error(`CHANGELOG.md:${lineNum}: Upgrade notes must be numbered steps.`);
      currentRelease.upgradeNotes.push({ text: um[1].trim(), line: lineNum });
      continue;
    }

    const bm = trimmed.match(/^-\s+(.*)$/);
    if (!bm) throw new Error(`CHANGELOG.md:${lineNum}: Entries must be single-line bullets.`);

    let body = bm[1].trim();
    let breaking = false;
    if (body.startsWith("**Breaking:**")) {
      breaking = true;
      body = body.slice("**Breaking:**".length).trim();
    }

    const scopeMatch = body.match(/^\*\*([^*:]+):\*\*\s*(.+)$/);
    if (!scopeMatch) {
      throw new Error(`CHANGELOG.md:${lineNum}: Entry missing bold scope tag.`);
    }

    const scope = scopeMatch[1].trim();
    const text = scopeMatch[2].trim();
    if (scopes.length > 0 && !scopes.includes(scope)) {
      throw new Error(`CHANGELOG.md:${lineNum}: Unknown scope "${scope}".`);
    }

    currentRelease.categories.get(currentSection.name).push({
      scope,
      text,
      breaking,
      raw: bm[1].trim(),
      line: lineNum,
    });
  }

  return { releases, compareLinks };
}

/**
 * @param {ReturnType<typeof parseChangelog>} parsed
 * @param {{ websiteRoot?: string, scopes?: string[], expectedCurrentVersion?: string, plannedTitles?: string[] }} [options]
 */
export function validateChangelog(
  parsed,
  {
    websiteRoot = WEBSITE_ROOT,
    scopes = loadChangelogScopes(websiteRoot),
    expectedCurrentVersion = getPackageMeta(websiteRoot).displayVersion,
    plannedTitles = [],
  } = {}
) {
  const errors = [];
  const { releases, compareLinks } = parsed;
  if (releases.length === 0) return ["CHANGELOG.md has no release sections."];

  const published = releases.filter((r) => !r.isUnreleased);
  if (published.length === 0) {
    errors.push("CHANGELOG.md must contain at least one published release.");
  } else if (published[0].version !== expectedCurrentVersion) {
    errors.push(
      `CHANGELOG.md:${published[0].line}: Top published release "${published[0].version}" does not match "${expectedCurrentVersion}".`
    );
  }

  for (let idx = 0; idx < releases.length; idx++) {
    const rel = releases[idx];
    if (rel.isUnreleased && idx !== 0) {
      errors.push(`CHANGELOG.md:${rel.line}: [Unreleased] must be first.`);
    }
    if (!rel.isUnreleased) {
      if (!rel.version.startsWith("v") || !isValidSemver(rel.version.slice(1))) {
        errors.push(`CHANGELOG.md:${rel.line}: Release "${rel.version}" must use v-prefixed SemVer.`);
      }
      if (!isValidIsoDate(rel.date)) {
        errors.push(`CHANGELOG.md:${rel.line}: Invalid date "${rel.date}".`);
      }
    }

    for (const [catName, entries] of rel.categories.entries()) {
      if (entries.length === 0) {
        errors.push(`CHANGELOG.md:${rel.line}: Empty category "### ${catName}".`);
      }
      let prevScopeIdx = -1;
      let prevCmp = "";
      for (const entry of entries) {
        if (!entry.text) errors.push(`CHANGELOG.md:${entry.line}: Entry cannot be empty.`);
        if (entry.raw.length > 200) {
          errors.push(`CHANGELOG.md:${entry.line}: Entry exceeds 200 characters (${entry.raw.length}).`);
        }
        if (
          /\bcommit\s+[0-9a-f]{7,40}\b/i.test(entry.text) ||
          /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/.test(entry.text)
        ) {
          errors.push(`CHANGELOG.md:${entry.line}: Entry contains a commit hash.`);
        }
        if (/(?:src|scripts|website|docs-site|drizzle|e2e|tests|\.github)\/[a-zA-Z0-9_./-]+/.test(entry.text)) {
          errors.push(`CHANGELOG.md:${entry.line}: Entry contains an internal file path.`);
        }
        for (const pTitle of plannedTitles) {
          if (entry.text.toLowerCase().includes(pTitle.toLowerCase())) {
            errors.push(`CHANGELOG.md:${entry.line}: Entry mentions planned roadmap item "${pTitle}".`);
          }
        }
        for (const docRoute of extractDocsLinks(entry.text)) {
          if (!docsRouteExists(websiteRoot, docRoute)) {
            errors.push(`CHANGELOG.md:${entry.line}: Broken [docs](${docRoute}) link.`);
          }
        }
        if (entry.breaking) {
          const repeated = rel.upgradeNotes.some((n) =>
            n.text.toLowerCase().includes(entry.text.slice(0, 24).toLowerCase())
          );
          if (!repeated) {
            errors.push(`CHANGELOG.md:${entry.line}: Breaking entry must be repeated in ### Upgrade notes.`);
          }
        }
        const scopeIdx = scopes.indexOf(entry.scope);
        const cmpKey = entry.text.toLowerCase();
        if (scopeIdx < prevScopeIdx || (scopeIdx === prevScopeIdx && cmpKey < prevCmp)) {
          errors.push(`CHANGELOG.md:${entry.line}: Entry out of order under ### ${catName}.`);
        }
        prevScopeIdx = scopeIdx;
        prevCmp = cmpKey;
      }
    }
  }

  for (let i = 1; i < published.length; i++) {
    const prev = published[i - 1];
    const curr = published[i];
    if (curr.date > prev.date || (curr.date === prev.date && compareSemverDesc(prev.version, curr.version) > 0)) {
      errors.push(`CHANGELOG.md:${curr.line}: Release "${curr.version}" out of order.`);
    }
  }

  for (const rel of published) {
    const link = compareLinks.get(rel.version);
    if (!link || !link.includes(rel.version)) {
      errors.push(`CHANGELOG.md: Missing compare/release link for [${rel.version}].`);
    }
  }

  return errors;
}

function mdxEscape(val) {
  return String(val ?? "").replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

function rewriteDocLinksToDocumentation(text) {
  return text.replace(/\[docs\]\(\/(?!documentation\/)([^)]+)\)/g, "[docs](/documentation/$1)");
}

function formatCategoryCounts(rel) {
  const parts = [];
  for (const cat of ALLOWED_CATEGORIES) {
    const count = rel.categories.get(cat)?.length || 0;
    if (count > 0) parts.push(`${count} ${cat.toLowerCase()}`);
  }
  return parts.join(", ") || "0 entries";
}

function countTotalEntries(rel) {
  let total = 0;
  for (const cat of ALLOWED_CATEGORIES) {
    total += rel.categories.get(cat)?.length || 0;
  }
  return total;
}

function renderCategoryPills(rel) {
  const pills = [];
  for (const cat of ALLOWED_CATEGORIES) {
    const count = rel.categories.get(cat)?.length || 0;
    if (count > 0) {
      pills.push(
        `<span class="pw-cl-cat-pill" data-cat="${cat.toLowerCase()}">${count} ${cat.toLowerCase()}</span>`
      );
    }
  }
  return pills.join("");
}

export function renderChangelogOverview(parsed, meta) {
  const { releases } = parsed;
  const published = releases.filter((r) => !r.isUnreleased);
  const latestVersion = published[0]?.version || meta.displayVersion;

  const lines = [
    "---",
    'title: "Changelog"',
    `description: "What changed in each release of Patchwork (current: ${meta.displayVersion})."`,
    "sidebar:",
    '  label: "Overview"',
    "  order: 0",
    "---",
    "",
    GENERATED_HEADER,
    "",
    `import { Badge } from "@astrojs/starlight/components";`,
    "",
    `<div class="pw-cl-intro">`,
    `  <p class="pw-cl-intro-lead">Release history for Patchwork. Current release: <strong>${meta.displayVersion}</strong>.</p>`,
    `  <div class="pw-cl-intro-links">`,
    `    <a href="/documentation/project/roadmap/">v1.0.0 Roadmap</a>`,
    `    <span aria-hidden="true">&middot;</span>`,
    `    <a href="/documentation/operations/backups-and-upgrades/">Backups &amp; Upgrades</a>`,
    `    <span aria-hidden="true">&middot;</span>`,
    `    <a href="/changelog.xml">RSS feed</a>`,
    `  </div>`,
    `</div>`,
    "",
  ];

  const unreleased = releases.find((r) => r.isUnreleased);
  if (unreleased && countTotalEntries(unreleased) === 0 && unreleased.highlights.length === 0) {
    lines.push(
      `<div class="pw-cl-unreleased-empty" data-cl-release="unreleased">`,
      `  <Badge text="Unreleased" variant="note" />`,
      `  <span>No unreleased changes queued yet.</span>`,
      `  <a href="/documentation/changelog/unreleased/">View Unreleased</a>`,
      `</div>`,
      ""
    );
  }

  lines.push(`<div class="pw-cl-timeline">`);
  for (const rel of releases) {
    const totalEntries = countTotalEntries(rel);
    if (rel.isUnreleased && totalEntries === 0 && rel.highlights.length === 0) {
      continue;
    }

    const slug = releaseSlug(rel.version);
    const isBeta = rel.version.includes("-");
    const badgeVariant = rel.isUnreleased ? "note" : isBeta ? "caution" : "success";
    const badgeText = rel.isUnreleased ? "Unreleased" : isBeta ? "Beta" : "Stable";
    const isLatest = rel.version === latestVersion;
    const pillsHtml = renderCategoryPills(rel);

    lines.push(
      `<article class="pw-cl-release-row" data-cl-release="${slug}"${isLatest ? ' data-latest="true"' : ""}>`
    );
    lines.push(`  <span class="pw-cl-timeline-dot" aria-hidden="true"></span>`);
    lines.push(`  <div class="pw-cl-release-header">`);
    lines.push(
      `    <div class="pw-cl-release-title"><h2><a href="/documentation/changelog/${slug}/">${rel.version}</a></h2> <Badge text="${badgeText}" variant="${badgeVariant}" />${isLatest ? ' <span class="pw-cl-latest-pill">Latest</span>' : ""}</div>`
    );
    if (rel.date) {
      lines.push(`    <time class="pw-cl-date" datetime="${rel.date}">${rel.date}</time>`);
    }
    lines.push(`  </div>`);

    if (pillsHtml) {
      lines.push(`  <div class="pw-cl-cat-pills">${pillsHtml}</div>`);
    }

    if (rel.highlights.length > 0) {
      lines.push(`  <ul class="pw-cl-highlights">`);
      for (const h of rel.highlights) lines.push(`    <li>${mdxEscape(h.text)}</li>`);
      lines.push(`  </ul>`);
    }

    lines.push(`  <div class="pw-cl-release-footer">`);
    lines.push(
      `    <a class="pw-cl-btn" href="/documentation/changelog/${slug}/">View details <span aria-hidden="true">&rarr;</span></a>`
    );
    lines.push(`  </div>`);
    lines.push(`</article>`);
  }
  lines.push(`</div>`, "");

  return lines.join("\n");
}

export function renderReleasePage(rel, idx, allReleases) {
  const isBeta = rel.version.includes("-");
  const badgeVariant = rel.isUnreleased ? "note" : isBeta ? "caution" : "success";
  const badgeText = rel.isUnreleased ? "Unreleased" : isBeta ? "Beta" : "Stable";
  const breakingEntries = Array.from(rel.categories.values()).flat().filter((e) => e.breaking);
  const sidebarOrder = rel.isUnreleased ? 99 : idx + 1;
  const totalEntries = countTotalEntries(rel);
  const activeCategories = ALLOWED_CATEGORIES.filter((cat) => (rel.categories.get(cat)?.length || 0) > 0);

  const lines = [
    "---",
    `title: "${rel.version}"`,
    `description: "Release notes for Patchwork ${rel.version}${rel.date ? ` (${rel.date})` : ""}."`,
    "sidebar:",
    `  label: "${rel.version}"`,
    `  order: ${sidebarOrder}`,
    "---",
    "",
    GENERATED_HEADER,
    "",
    `import { Aside, Badge } from "@astrojs/starlight/components";`,
    "",
    `<div class="pw-cl-meta">`,
    `  <Badge text="${badgeText}" variant="${badgeVariant}" />${rel.date ? ` <time class="pw-cl-date" datetime="${rel.date}">Released ${rel.date}</time>` : ""}${totalEntries > 0 ? ` <span class="pw-cl-meta-count">${totalEntries} ${totalEntries === 1 ? "change" : "changes"}</span>` : ""} <a class="pw-cl-back-link" href="/documentation/changelog/">&larr; All releases</a>`,
    `</div>`,
    "",
  ];

  if (breakingEntries.length > 0) {
    lines.push(`<Aside type="caution" title="Breaking changes">`);
    for (const b of breakingEntries) {
      lines.push(`- **${mdxEscape(b.scope)}:** ${mdxEscape(rewriteDocLinksToDocumentation(b.text))}`);
    }
    lines.push(`</Aside>`, "");
  }

  if (rel.highlights.length > 0) {
    lines.push(`<Aside type="tip" title="Highlights">`);
    for (const h of rel.highlights) lines.push(`- ${mdxEscape(h.text)}`);
    lines.push(`</Aside>`, "");
  }

  if (rel.upgradeNotes.length > 0) {
    lines.push(`<Aside type="caution" title="Upgrade notes">`);
    rel.upgradeNotes.forEach((n, nIdx) => {
      lines.push(`${nIdx + 1}. ${mdxEscape(rewriteDocLinksToDocumentation(n.text))}`);
    });
    lines.push(`</Aside>`, "");
  }

  if (activeCategories.length > 1) {
    lines.push(`<nav class="pw-cl-jump" aria-label="Change categories">`);
    for (const catName of activeCategories) {
      const count = rel.categories.get(catName)?.length || 0;
      lines.push(
        `  <a class="pw-cl-jump-pill" data-cat="${catName.toLowerCase()}" href="#${catName.toLowerCase()}">${catName} <span>${count}</span></a>`
      );
    }
    lines.push(`</nav>`, "");
  }

  lines.push(`<div class="pw-cl-measure">`);
  if (activeCategories.length === 0 && rel.highlights.length === 0 && rel.upgradeNotes.length === 0) {
    lines.push(
      `<p class="pw-cl-empty-note">No changes are queued for this release yet. New entries added under <code>## [Unreleased]</code> in <code>CHANGELOG.md</code> will appear here.</p>`
    );
  }
  for (const catName of activeCategories) {
    const entries = rel.categories.get(catName);
    const isSecurity = catName === "Security";
    lines.push(`<section id="${catName.toLowerCase()}" class="pw-cl-section" data-cat="${catName.toLowerCase()}">`, "");
    lines.push(
      `## ${catName} <span class="pw-cl-cat-count">${entries.length}</span>${isSecurity ? ' <Badge text="Security" variant="caution" />' : ""}`,
      ""
    );

    const byScope = new Map();
    for (const e of entries) {
      if (!byScope.has(e.scope)) byScope.set(e.scope, []);
      byScope.get(e.scope).push(e);
    }

    const collapse = entries.length > 24;
    if (collapse) lines.push(`<details class="pw-cl-details"><summary>Show all ${entries.length} entries</summary>`, "");
    lines.push(`<div class="pw-cl-list pw-cl-list--release">`);
    for (const [scope, scopeEntries] of byScope.entries()) {
      lines.push(`  <div class="pw-cl-scope-group">`);
      lines.push(`    <span class="pw-cl-scope">${mdxEscape(scope)}</span>`);
      lines.push(`    <ul class="pw-cl-scope-items">`);
      for (const e of scopeEntries) {
        const breakingBadge = e.breaking ? '<Badge text="Breaking" variant="danger" /> ' : "";
        lines.push(
          `      <li>${breakingBadge}${mdxEscape(rewriteDocLinksToDocumentation(e.text))}</li>`
        );
      }
      lines.push(`    </ul>`);
      lines.push(`  </div>`);
    }
    lines.push(`</div>`);
    if (collapse) lines.push(`</details>`, "");
    lines.push(`</section>`, "");
  }
  lines.push(`</div>`, "");

  const prevRel = idx + 1 < allReleases.length ? allReleases[idx + 1] : null;
  const nextRel = idx - 1 >= 0 ? allReleases[idx - 1] : null;
  if (prevRel || nextRel) {
    lines.push(`<nav class="pw-cl-pager" aria-label="Release navigation">`);
    lines.push(
      prevRel
        ? `  <a class="pw-cl-pager-link" href="/documentation/changelog/${releaseSlug(prevRel.version)}/"><span class="pw-cl-pager-dir">&larr; Previous</span><span class="pw-cl-pager-ver">${prevRel.version}</span></a>`
        : `  <span></span>`
    );
    lines.push(
      nextRel
        ? `  <a class="pw-cl-pager-link pw-cl-pager-link--next" href="/documentation/changelog/${releaseSlug(nextRel.version)}/"><span class="pw-cl-pager-dir">Next &rarr;</span><span class="pw-cl-pager-ver">${nextRel.version}</span></a>`
        : `  <span></span>`
    );
    lines.push(`</nav>`, "");
  }

  return lines.join("\n");
}

function xmlEscape(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderChangelogRss(parsed, siteBaseUrl = "https://getpatchwork.in") {
  const cleanBase = siteBaseUrl.replace(/\/+$/, "");
  const published = parsed.releases.filter((r) => !r.isUnreleased);
  const itemsXml = published
    .map((rel) => {
      const slug = releaseSlug(rel.version);
      const link = `${cleanBase}/documentation/changelog/${slug}/`;
      const summary =
        rel.highlights.map((h) => h.text).join(" ") ||
        `Patchwork ${rel.version} release notes (${formatCategoryCounts(rel)}).`;
      const pubDate = new Date(`${rel.date}T00:00:00Z`).toUTCString();
      return [
        "    <item>",
        `      <title>${xmlEscape(`Patchwork ${rel.version}`)}</title>`,
        `      <link>${xmlEscape(link)}</link>`,
        `      <guid isPermaLink="true">${xmlEscape(link)}</guid>`,
        `      <pubDate>${xmlEscape(pubDate)}</pubDate>`,
        `      <description>${xmlEscape(summary)}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    "    <title>Patchwork Changelog</title>",
    `    <link>${xmlEscape(`${cleanBase}/documentation/changelog/`)}</link>`,
    "    <description>Release notes for Patchwork.</description>",
    "    <language>en-us</language>",
    itemsXml,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

export function generateChangelogDocs(websiteRoot = WEBSITE_ROOT) {
  const meta = getPackageMeta(websiteRoot);
  const scopes = loadChangelogScopes(websiteRoot);
  const roadmap = loadRoadmap(websiteRoot);
  const plannedTitles = (roadmap.items || []).filter((it) => it.status === "planned").map((it) => it.title);

  const changelogPath = path.join(websiteRoot, "src/data/generated/CHANGELOG.md");
  const parsed = parseChangelog(fs.readFileSync(changelogPath, "utf8"), { scopes });
  const errs = validateChangelog(parsed, {
    websiteRoot,
    scopes,
    expectedCurrentVersion: meta.displayVersion,
    plannedTitles,
  });
  if (errs.length > 0) throw new Error(`Invalid CHANGELOG.md:\n  - ${errs.join("\n  - ")}`);

  const outDir = path.join(websiteRoot, "src/content/docs/documentation/changelog");
  fs.mkdirSync(outDir, { recursive: true });

  const expectedFiles = new Map();
  expectedFiles.set("index.mdx", renderChangelogOverview(parsed, meta));
  parsed.releases.forEach((rel, idx) => {
    expectedFiles.set(`${releaseSlug(rel.version)}.mdx`, renderReleasePage(rel, idx, parsed.releases));
  });

  for (const f of fs.readdirSync(outDir)) {
    if (!expectedFiles.has(f)) fs.rmSync(path.join(outDir, f), { force: true });
  }
  for (const [name, content] of expectedFiles.entries()) {
    fs.writeFileSync(path.join(outDir, name), content, "utf8");
  }

  const publicDir = path.join(websiteRoot, "public");
  fs.mkdirSync(publicDir, { recursive: true });
  const rssBase = process.env.SITE_URL || meta.docsSiteUrl || "https://getpatchwork.in";
  fs.writeFileSync(path.join(publicDir, "changelog.xml"), renderChangelogRss(parsed, rssBase), "utf8");

  return Array.from(expectedFiles.keys());
}

export function checkChangelog(websiteRoot = WEBSITE_ROOT) {
  const errors = [];
  const meta = getPackageMeta(websiteRoot);
  const scopes = loadChangelogScopes(websiteRoot);
  const roadmap = loadRoadmap(websiteRoot);
  const plannedTitles = (roadmap.items || []).filter((it) => it.status === "planned").map((it) => it.title);

  const changelogPath = path.join(websiteRoot, "src/data/generated/CHANGELOG.md");
  if (!fs.existsSync(changelogPath)) return ["Missing src/data/generated/CHANGELOG.md"];

  let parsed;
  try {
    parsed = parseChangelog(fs.readFileSync(changelogPath, "utf8"), { scopes });
  } catch (err) {
    return [err instanceof Error ? err.message : String(err)];
  }

  errors.push(
    ...validateChangelog(parsed, {
      websiteRoot,
      scopes,
      expectedCurrentVersion: meta.displayVersion,
      plannedTitles,
    })
  );
  if (errors.length > 0) return errors;

  const outDir = path.join(websiteRoot, "src/content/docs/documentation/changelog");
  const expectedFiles = new Map();
  expectedFiles.set("index.mdx", renderChangelogOverview(parsed, meta));
  parsed.releases.forEach((rel, idx) => {
    expectedFiles.set(`${releaseSlug(rel.version)}.mdx`, renderReleasePage(rel, idx, parsed.releases));
  });

  for (const [name, expected] of expectedFiles.entries()) {
    const p = path.join(outDir, name);
    if (!fs.existsSync(p)) errors.push(`Missing changelog/${name}. Run npm run generate.`);
    else if (fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n") !== expected) {
      errors.push(`Out-of-date changelog/${name}. Run npm run generate.`);
    }
  }

  const rssPath = path.join(websiteRoot, "public/changelog.xml");
  const rssBase = process.env.SITE_URL || meta.docsSiteUrl || "https://getpatchwork.in";
  const expectedRss = renderChangelogRss(parsed, rssBase);
  if (!fs.existsSync(rssPath)) errors.push("Missing public/changelog.xml. Run npm run generate.");
  else if (fs.readFileSync(rssPath, "utf8").replace(/\r\n/g, "\n") !== expectedRss) {
    errors.push("public/changelog.xml out of date. Run npm run generate.");
  }

  return errors;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--check")) {
    const errs = checkChangelog();
    if (errs.length > 0) {
      console.error("changelog:check failed:");
      for (const e of errs) console.error(`  - ${e}`);
      process.exit(1);
    }
    console.log("changelog:check passed.");
  } else {
    const files = generateChangelogDocs();
    console.log(`Generated changelog pages: ${files.join(", ")} + changelog.xml`);
  }
}
