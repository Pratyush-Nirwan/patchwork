import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WEBSITE_ROOT, getPackageMeta, loadGeneratedJson, isValidSemver } from "./lib/meta.mjs";

const GENERATED_HEADER =
  "{/* Generated file, do not edit. Run `npm run generate` to update. */}";

export const PLANNED_WORK_DISCLAIMER =
  "This roadmap describes planned work. Scope and timing may change.";

const VALID_STATUSES = new Set(["planned", "in-progress", "shipped"]);

const STATUS_LABELS = {
  planned: "Planned",
  "in-progress": "In progress",
  shipped: "Shipped",
};

function stripQuotes(raw) {
  const s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return s;
}

function parseInlineArray(raw) {
  const inner = raw.trim().slice(1, -1).trim();
  if (!inner) return [];
  const parts = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      if (ch === quote && inner[i - 1] !== "\\") quote = null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ",") {
      if (cur.trim()) parts.push(stripQuotes(cur));
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(stripQuotes(cur));
  return parts;
}

function parseScalarOrArray(raw) {
  const s = raw.trim();
  if (s === "{}") return {};
  if (s.startsWith("[") && s.endsWith("]")) return parseInlineArray(s);
  return stripQuotes(s);
}

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   category: string,
 *   summary: string,
 *   status: string,
 *   target: string,
 *   shippedIn: string,
 *   dependsOn: string[],
 *   notes?: string,
 *   codeSignals?: Record<string, string[]>,
 * }} RoadmapItem
 *
 * @typedef {{
 *   currentVersion: string,
 *   targetVersion: string,
 *   categories: Array<{ id: string, title: string }>,
 *   items: RoadmapItem[],
 * }} RoadmapData
 */

export function parseRoadmapYaml(yamlText) {
  const lines = yamlText.replace(/\r\n/g, "\n").split("\n");
  const root = { categories: [], items: [] };
  let section = null;
  let currentObj = null;
  let subKey = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;

    const indent = rawLine.search(/\S/);
    const trimmed = rawLine.trim();

    if (indent === 0) {
      subKey = null;
      currentObj = null;
      const kv = trimmed.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
      if (!kv) throw new Error(`Invalid YAML at line ${i + 1}: ${trimmed}`);
      const [, key, rest] = kv;
      if (key === "categories" || key === "items") {
        section = key;
      } else {
        section = null;
        root[key] = parseScalarOrArray(rest);
      }
      continue;
    }

    if (indent === 2 && trimmed.startsWith("- ")) {
      if (!section) throw new Error(`Unexpected list item at line ${i + 1}`);
      subKey = null;
      currentObj = {};
      root[section].push(currentObj);
      const rest = trimmed.slice(2).trim();
      if (rest) {
        const kv = rest.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
        if (!kv) throw new Error(`Invalid list item property at line ${i + 1}`);
        currentObj[kv[1]] = parseScalarOrArray(kv[2]);
      }
      continue;
    }

    if (indent === 4 && currentObj) {
      const kv = trimmed.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
      if (!kv) throw new Error(`Invalid property at line ${i + 1}: ${trimmed}`);
      const [, key, rest] = kv;
      if (rest === "") {
        currentObj[key] = {};
        subKey = key;
      } else {
        subKey = null;
        currentObj[key] = parseScalarOrArray(rest);
      }
      continue;
    }

    if (indent === 6 && currentObj && subKey && typeof currentObj[subKey] === "object") {
      const kv = trimmed.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
      if (!kv) throw new Error(`Invalid nested property at line ${i + 1}: ${trimmed}`);
      currentObj[subKey][kv[1]] = parseScalarOrArray(kv[2]);
      continue;
    }

    throw new Error(`Unsupported YAML syntax at line ${i + 1}: ${rawLine}`);
  }

  return /** @type {RoadmapData} */ (root);
}

/**
 * @param {RoadmapData} data
 * @param {string | null} [expectedCurrentVersion]
 */
export function validateRoadmap(data, expectedCurrentVersion = null) {
  const errors = [];
  if (!data || typeof data !== "object") return ["Roadmap data must be an object."];

  const normalizeVer = (v) => String(v || "").replace(/^v/, "");
  if (!data.currentVersion || !isValidSemver(normalizeVer(data.currentVersion))) {
    errors.push(`Invalid currentVersion in roadmap.yaml: "${data.currentVersion || ""}"`);
  } else if (expectedCurrentVersion && data.currentVersion !== expectedCurrentVersion) {
    errors.push(
      `roadmap.yaml currentVersion "${data.currentVersion}" does not match app-meta.json "${expectedCurrentVersion}".`
    );
  }

  if (!data.targetVersion || !isValidSemver(normalizeVer(data.targetVersion))) {
    errors.push(`Invalid targetVersion in roadmap.yaml: "${data.targetVersion || ""}"`);
  }

  const categoryIds = new Set();
  for (const cat of data.categories || []) {
    if (!cat.id || !cat.title) errors.push("Every roadmap category must have id and title.");
    if (categoryIds.has(cat.id)) errors.push(`Duplicate roadmap category id: ${cat.id}`);
    categoryIds.add(cat.id);
  }

  const itemIds = new Set();
  for (const item of data.items || []) {
    if (!item.id) errors.push("Roadmap item missing id.");
    if (itemIds.has(item.id)) errors.push(`Duplicate roadmap item id: ${item.id}`);
    itemIds.add(item.id);
  }

  for (const item of data.items || []) {
    if (!item.title || !item.summary) errors.push(`Roadmap item "${item.id}" must have title and summary.`);
    if (!categoryIds.has(item.category)) errors.push(`Roadmap item "${item.id}" unknown category "${item.category}".`);
    if (!VALID_STATUSES.has(item.status)) errors.push(`Roadmap item "${item.id}" invalid status "${item.status}".`);
    if (!item.target || !isValidSemver(normalizeVer(item.target))) errors.push(`Roadmap item "${item.id}" invalid target.`);
    const shippedIn = String(item.shippedIn || "").trim();
    if (item.status === "shipped") {
      if (!shippedIn || !isValidSemver(normalizeVer(shippedIn))) {
        errors.push(`Shipped roadmap item "${item.id}" must specify valid shippedIn.`);
      }
    } else if (shippedIn) {
      errors.push(`Non-shipped roadmap item "${item.id}" must not set shippedIn.`);
    }
    for (const dep of item.dependsOn || []) {
      if (dep === item.id) errors.push(`Roadmap item "${item.id}" cannot depend on itself.`);
      else if (!itemIds.has(dep)) errors.push(`Roadmap item "${item.id}" unknown dependsOn "${dep}".`);
    }
  }
  return errors;
}

export function loadRoadmap(websiteRoot = WEBSITE_ROOT) {
  const yamlPath = path.join(websiteRoot, "src/data/roadmap.yaml");
  return parseRoadmapYaml(fs.readFileSync(yamlPath, "utf8"));
}

export function extractLiveCodeSnapshot(websiteRoot = WEBSITE_ROOT) {
  const commands = new Set(loadGeneratedJson("commands.json", websiteRoot).map((c) => c.name));
  const envVars = new Set(loadGeneratedJson("env.json", websiteRoot).map((e) => e.name));
  const permissions = new Set(loadGeneratedJson("permissions.json", websiteRoot).map((p) => p.id));
  const schema = loadGeneratedJson("schema.json", websiteRoot);
  const routes = new Set(schema.apiRouteGroups || []);
  const tables = new Set((schema.tables || []).map((t) => t.tableName));
  const settings = new Set();
  for (const sec of loadGeneratedJson("settings.json", websiteRoot)) {
    for (const f of sec.fields) {
      settings.add(`${sec.key}.${f.name}`);
      settings.add(f.name);
    }
  }
  return { commands, settings, envVars, permissions, routes, tables };
}

export function checkPlannedCodeSignals(roadmap, codeSnapshot) {
  const errors = [];
  for (const item of roadmap.items || []) {
    if (item.status !== "planned") continue;
    const signals = item.codeSignals || {};
    const checks = [
      ["commands", codeSnapshot.commands],
      ["settings", codeSnapshot.settings],
      ["envVars", codeSnapshot.envVars],
      ["permissions", codeSnapshot.permissions],
      ["routes", codeSnapshot.routes],
      ["tables", codeSnapshot.tables],
    ];
    for (const [kind, liveSet] of checks) {
      for (const sig of signals[kind] || []) {
        if (liveSet.has(sig)) {
          errors.push(`Planned roadmap item "${item.id}" matches live code ${kind} signal "${sig}".`);
        }
      }
    }
  }
  return errors;
}

function mdxEscape(val) {
  return String(val ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}");
}

export function renderRoadmapPage(roadmap, meta) {
  const byId = new Map((roadmap.items || []).map((it) => [it.id, it]));
  const currentVer = meta.displayVersion;
  const targetVer = roadmap.targetVersion;
  const allItems = roadmap.items || [];
  const shippedItems = allItems.filter((it) => it.status === "shipped");
  const plannedItems = allItems.filter((it) => it.status !== "shipped");

  const lines = [
    "---",
    'title: "Roadmap & Known Limitations"',
    `description: "Planned features for Patchwork ${targetVer} and known scope boundaries in ${currentVer}."`,
    "---",
    "",
    GENERATED_HEADER,
    "",
    `<div class="pw-cl-meta">`,
    "",
    `Current release: **${currentVer}** &middot; Target release: **${targetVer}**`,
    "",
    `  <a class="pw-cl-back-link" href="/documentation/introduction/overview/">Feature Overview &rarr;</a>`,
    `</div>`,
    "",
    `<p class="pw-rm-disclaimer">${PLANNED_WORK_DISCLAIMER}</p>`,
    "",
    `<div class="pw-rm-legend" aria-label="Status legend">`,
    `  <span class="pw-rm-legend-item" data-status="planned"><strong>Planned</strong> &mdash; Intended for ${targetVer}; not available in ${currentVer}</span>`,
    `  <span class="pw-rm-legend-item" data-status="in-progress"><strong>In progress</strong> &mdash; Actively under development</span>`,
    `  <span class="pw-rm-legend-item" data-status="shipped"><strong>Shipped</strong> &mdash; Released and documented</span>`,
    `</div>`,
    "",
  ];

  const renderItemRow = (item, fallbackCatId) => {
    const statusText =
      item.status === "shipped" && item.shippedIn
        ? `${STATUS_LABELS[item.status]} · ${item.shippedIn}`
        : `${STATUS_LABELS[item.status]} · ${item.target}`;
    const deps = (item.dependsOn || [])
      .map((d) => {
        const targetItem = byId.get(d);
        return targetItem ? `[${mdxEscape(targetItem.title)}](#${targetItem.id})` : mdxEscape(d);
      })
      .join(", ");

    lines.push(`  <div class="pw-rm-item" id="${item.id}" data-status="${item.status}">`);
    lines.push(`    <div class="pw-rm-status"><span>${mdxEscape(statusText)}</span></div>`);
    lines.push(`    <div class="pw-rm-body">`);
    lines.push(`      <div class="pw-rm-title">${mdxEscape(item.title)}</div>`);
    lines.push(`      <p class="pw-rm-summary">${mdxEscape(item.summary)}</p>`);
    if (deps) {
      lines.push(`      <p class="pw-rm-deps">Depends on: ${deps}</p>`);
    }
    lines.push(`    </div>`);
    lines.push(`  </div>`);
    void fallbackCatId;
  };

  for (const cat of roadmap.categories || []) {
    const catPlanned = plannedItems.filter((it) => it.category === cat.id);
    if (catPlanned.length === 0) continue;
    lines.push(`<section id="${cat.id}">`, "", `## ${cat.title}`, "");
    lines.push(`<div class="pw-rm-list">`);
    for (const item of catPlanned) {
      renderItemRow(item, cat.id);
    }
    lines.push(`</div>`, `</section>`, "");
  }

  if (shippedItems.length > 0) {
    lines.push(`<section id="collaboration-and-notifications">`, "", `## Shipped in ${currentVer}`, "");
    lines.push(`<div class="pw-rm-list">`);
    for (const item of shippedItems) {
      renderItemRow(item, item.category);
    }
    lines.push(`</div>`, `</section>`, "");
  }

  lines.push(
    `## Known Limitations in ${currentVer}`,
    "",
    `The following capabilities are **not yet available in ${currentVer}** and are tracked in the ${targetVer} roadmap above:`,
    "",
    `- **Inbound GitHub and GitLab webhooks**: Planned for ${targetVer} ([Git and Developer Integrations](#git-and-developer-integrations)).`,
    `- **Email-to-ticket intake**: Planned for ${targetVer} ([Git and Developer Integrations](#git-and-developer-integrations)).`,
    `- **Standalone audit log viewer**: Planned for ${targetVer} ([Security, Audit, and Operations](#security-audit-and-operations)).`,
    `- **Personal API tokens (PATs) and public REST API**: Planned for ${targetVer} ([Git and Developer Integrations](#git-and-developer-integrations)).`,
    `- **2FA, passkeys, and SSO / OAuth login**: Planned for ${targetVer} ([Security, Audit, and Operations](#security-audit-and-operations)).`,
    "",
    "### Out of Scope (Not on the Roadmap)",
    "",
    "- **Docker / container images**: Patchwork is intentionally native-only on Windows and Linux.",
    "- **Native desktop or mobile apps**: Patchwork is a responsive web application for desktop and mobile browsers.",
    ""
  );

  return lines.join("\n");
}

export function renderLandingStrip(roadmap) {
  const catNames = (roadmap.categories || []).map((c) => c.title).join(" · ");
  return [
    "{/* ROADMAP_STRIP_START */}",
    `<div class="pw-docs-roadmap-strip">`,
    `  <div class="pw-docs-roadmap-copy">`,
    `    <strong>Coming in ${roadmap.targetVersion}</strong>`,
    `    <span>${catNames}</span>`,
    `  </div>`,
    `  <a class="pw-cl-btn" href="/documentation/project/roadmap/">View ${roadmap.targetVersion} Roadmap &rarr;</a>`,
    `</div>`,
    "{/* ROADMAP_STRIP_END */}",
  ].join("\n");
}

export function renderGuideAdmonition(roadmap, ids, meta) {
  const byId = new Map((roadmap.items || []).map((it) => [it.id, it]));
  const items = ids.map((id) => byId.get(id)).filter((it) => it && it.status !== "shipped");
  if (items.length === 0) return "";
  const links = items.map((it) => `[${it.title}](/documentation/project/roadmap/#${it.id})`).join(", ");
  return [
    `{/* ROADMAP_ADMONITION_START:${ids.join(",")} */}`,
    `<Aside type="note" title="Planned for ${roadmap.targetVersion}">`,
    `Not available in ${meta.displayVersion}: ${links}. See the [${roadmap.targetVersion} Roadmap](/documentation/project/roadmap/).`,
    `</Aside>`,
    `{/* ROADMAP_ADMONITION_END */}`,
  ].join("\n");
}

function replaceMarkerBlock(content, startRegex, endMarker, replacement) {
  const startMatch = content.match(startRegex);
  if (!startMatch) return null;
  const startIdx = startMatch.index;
  const endIdx = content.indexOf(endMarker, startIdx);
  if (endIdx === -1) return null;
  return content.slice(0, startIdx) + replacement + content.slice(endIdx + endMarker.length);
}

export function generateRoadmapDocs(websiteRoot = WEBSITE_ROOT) {
  const meta = getPackageMeta(websiteRoot);
  const roadmap = loadRoadmap(websiteRoot);
  const errs = validateRoadmap(roadmap, meta.displayVersion);
  if (errs.length > 0) throw new Error(`Invalid roadmap.yaml:\n  - ${errs.join("\n  - ")}`);

  const docsDir = path.join(websiteRoot, "src/content/docs/documentation");
  const updatedFiles = [];

  fs.writeFileSync(path.join(docsDir, "project/roadmap.mdx"), renderRoadmapPage(roadmap, meta), "utf8");
  updatedFiles.push("project/roadmap.mdx");

  const indexPath = path.join(docsDir, "index.mdx");
  if (fs.existsSync(indexPath)) {
    const idxText = fs.readFileSync(indexPath, "utf8").replace(/\r\n/g, "\n");
    const updatedIdx = replaceMarkerBlock(
      idxText,
      /\{\/\* ROADMAP_STRIP_START \*\/\}/,
      "{/* ROADMAP_STRIP_END */}",
      renderLandingStrip(roadmap)
    );
    if (updatedIdx !== null) {
      fs.writeFileSync(indexPath, updatedIdx, "utf8");
      updatedFiles.push("index.mdx");
    }
  }

  for (const rel of [
    "user-guide/workspace-and-boards.mdx",
    "user-guide/tickets-and-collaboration.mdx",
    "user-guide/search-and-filters.mdx",
    "user-guide/attachments-and-links.mdx",
    "admin-guide/system-configuration.mdx",
    "admin-guide/sessions-and-security-policy.mdx",
    "operations/security.mdx",
    "operations/backups-and-upgrades.mdx",
  ]) {
    const full = path.join(docsDir, rel);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, "utf8").replace(/\r\n/g, "\n");
    const m = text.match(/\{\/\* ROADMAP_ADMONITION_START:([a-z0-9,-]+) \*\/\}/);
    if (!m) continue;
    const block = renderGuideAdmonition(roadmap, m[1].split(",").filter(Boolean), meta);
    const updated = replaceMarkerBlock(
      text,
      /\{\/\* ROADMAP_ADMONITION_START:[a-z0-9,-]+ \*\/\}/,
      "{/* ROADMAP_ADMONITION_END */}",
      block
    );
    if (updated !== null) {
      fs.writeFileSync(full, updated, "utf8");
      updatedFiles.push(rel);
    }
  }

  return updatedFiles;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = generateRoadmapDocs();
  console.log(`Generated roadmap docs: ${files.join(", ")}`);
}
