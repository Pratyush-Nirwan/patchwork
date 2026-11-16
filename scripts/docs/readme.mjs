import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_REPO_ROOT, getVersionInfo } from "../lib/version.mjs";
import { loadRoadmap } from "../../website/scripts/roadmap.mjs";

function renderReadmeRoadmapSection(roadmap, versionInfo, docsSiteUrl) {
  const lines = [
    `Planned for **${roadmap.targetVersion}** (not yet available in ${versionInfo.displayVersion}). This roadmap describes planned work. Scope and timing may change.`,
    "",
  ];
  for (const cat of roadmap.categories || []) {
    const titles = (roadmap.items || [])
      .filter((it) => it.category === cat.id)
      .map((it) => it.title)
      .join(", ");
    lines.push(`- **${cat.title}**: ${titles}`);
  }
  lines.push(
    "",
    "- **Out of scope**: Docker / container images, native desktop and mobile apps.",
    `- **Full details**: [Patchwork ${roadmap.targetVersion} Roadmap](${docsSiteUrl}documentation/project/roadmap/)`
  );
  return lines.join("\n");
}

const TREE_ANNOTATIONS = {
  deploy: "Caddy, Nginx, and systemd service templates",
  docs: "Specs, README template/assets, and internal reports",
  drizzle: "Plain SQL database migrations",
  e2e: "Playwright end-to-end tests",
  scripts: "Node.js CLI installer, seeder, and docs/version tooling",
  src: "Next.js App Router pages, API routes, components, and lib",
  tests: "Vitest unit and integration suites",
  website: "Self-contained public website and Starlight docs package",
};

const TREE_EXCLUDES = new Set([
  ".git",
  ".next",
  ".minio-data",
  "node_modules",
  "documentation-dist",
  "logs",
  "backups",
  "bin",
  "test-results",
  "playwright-report",
  ".astro",
  "dist",
]);

function buildProjectTree(repoRoot) {
  const lines = ["patchwork/"];
  const entries = fs
    .readdirSync(repoRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !TREE_EXCLUDES.has(e.name) && !e.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));

  entries.forEach((entry, idx) => {
    const isLast = idx === entries.length - 1;
    const prefix = isLast ? "└── " : "├── ";
    const note = TREE_ANNOTATIONS[entry.name] ? ` # ${TREE_ANNOTATIONS[entry.name]}` : "";
    lines.push(`${prefix}${entry.name}/${note}`);
  });
  return lines.join("\n");
}

function buildFeaturesList() {
  return [
    "- **Boards & tickets**: Custom Kanban columns per team with drag-and-drop, WIP gauges, Calendar view, markdown, assignees, priorities, labels, comments, and activity history.",
    "- **Real-time sync**: Live board updates pushed over PostgreSQL `LISTEN/NOTIFY` and Server-Sent Events (`/api/events`).",
    "- **Scoped search**: Full-text search across tickets, comments, and extracted attachment text (`.pdf`, `.txt`, `.md`, `.csv`, `.json`) enforced by RBAC.",
    "- **Command bar**: Spotlight palette (`Ctrl+K` / `Cmd+K`) with filters, slash commands, inline ghost hints, and session history.",
    "- **Access control**: `argon2id` email/password auth, `admin`/`lead`/`member`/`viewer` roles (`developer`/`tester` sub-roles), admin-only System Configuration, and one-time Admin Setup Token.",
    "- **Attachments & links**: MinIO presigned uploads with size/MIME limits, plus GitHub and GitLab link previews.",
    "- **Operations**: Native CLI installer (`repair`, `reset`, `--check`), `/api/health`, diagnostics export, and bundled `/documentation`.",
    "- **Cross-platform**: Runs natively on Windows 10/11 and Linux (Ubuntu 22.04/24.04, Debian 12).",
  ].join("\n");
}

export function renderReadme(repoRoot = DEFAULT_REPO_ROOT) {
  const templatePath = path.join(repoRoot, "docs/README.template.md");
  const template = fs.readFileSync(templatePath, "utf8").replace(/\r\n/g, "\n");
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const { displayVersion, channel } = getVersionInfo(repoRoot);

  const rawRepoUrl = pkg.repository?.url || "https://github.com/Pratyush-Nirwan/patchwork.git";
  const cloneUrl = rawRepoUrl.replace(/^git\+/, "");
  const nodeReq = pkg.engines?.node || ">=20";
  const license = (pkg.license || "AGPL-3.0-only").replace("-only", "");
  const docsSiteUrl = "https://pratyush-nirwan.github.io/patchwork/";

  const badgeVer = displayVersion.replace(/-/g, "--");
  const badgeLicense = encodeURIComponent(license.replace(/-/g, "--"));
  const badgeNode = encodeURIComponent(nodeReq.replace(/-/g, "--"));
  const badges = [
    `![Version ${displayVersion}](https://img.shields.io/badge/version-${badgeVer}-C84317?style=flat-square)`,
    `![License ${license}](https://img.shields.io/badge/license-${badgeLicense}-1D242E?style=flat-square)`,
    `![Node ${nodeReq}](https://img.shields.io/badge/node-${badgeNode}-339933?style=flat-square)`,
    `![Platforms Windows & Linux](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-2563EB?style=flat-square)`,
    `![Status ${channel}](https://img.shields.io/badge/status-${encodeURIComponent(channel)}-D97706?style=flat-square)`,
    `[![OpenRepos](https://img.shields.io/endpoint?url=https://openrepos.org/status/patchwork.openrepos.org.json&style=flat-square)](https://patchwork.openrepos.org/)`,
  ].join(" ");

  const quickLinks = [
    `[Documentation](${docsSiteUrl})`,
    "[Quick Start](#quick-start)",
    "[Features](#features)",
    "[Contributing](CONTRIBUTING.md)",
  ].join(" · ");

  const roadmap = loadRoadmap(path.join(repoRoot, "website"));
  const roadmapSection = renderReadmeRoadmapSection(
    roadmap,
    { displayVersion, channel },
    docsSiteUrl
  );

  const replacements = {
    "{{GENERATED_NOTICE}}":
      "<!-- Generated by `npm run readme:generate`, edit `docs/README.template.md` -->",
    "{{BADGES}}": badges,
    "{{QUICK_LINKS}}": quickLinks,
    "{{NODE_REQUIREMENT}}": nodeReq,
    "{{REPO_CLONE_URL}}": cloneUrl,
    "{{DOCS_SITE_URL}}": docsSiteUrl,
    "{{FEATURES_LIST}}": buildFeaturesList(),
    "{{PROJECT_TREE}}": buildProjectTree(repoRoot),
    "{{ROADMAP_SECTION}}": roadmapSection,
    "{{DISPLAY_VERSION}}": displayVersion,
    "{{LICENSE}}": license,
  };

  let output = template;
  for (const [key, value] of Object.entries(replacements)) {
    output = output.split(key).join(value);
  }
  return `${output.trimEnd()}\n`;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const repoRoot = DEFAULT_REPO_ROOT;
  const content = renderReadme(repoRoot);
  fs.writeFileSync(path.join(repoRoot, "README.md"), content, "utf8");
  console.log("Generated README.md from docs/README.template.md");
}
