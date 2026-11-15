import fs from "node:fs";
import path from "node:path";
import { findRepoRoot } from "./extract.mjs";

const repoRoot = findRepoRoot();
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const version = process.argv[2] || pkg.version;
const today = new Date().toISOString().slice(0, 10);

const changelogPath = path.join(repoRoot, "CHANGELOG.md");
if (!fs.existsSync(changelogPath)) {
  console.error("CHANGELOG.md not found");
  process.exit(1);
}

let content = fs.readFileSync(changelogPath, "utf8").replace(/\r\n/g, "\n");
const unreleasedHeader = "## [Unreleased]";
const idx = content.indexOf(unreleasedHeader);
if (idx === -1) {
  console.error("Could not find '## [Unreleased]' in CHANGELOG.md");
  process.exit(1);
}

const afterHeader = content.slice(idx + unreleasedHeader.length);
const nextSectionMatch = afterHeader.match(/\n## \[/);
const unreleasedBody = nextSectionMatch
  ? afterHeader.slice(0, nextSectionMatch.index).trim()
  : afterHeader.trim();

if (!unreleasedBody) {
  console.log("Nothing under [Unreleased] to release.");
  process.exit(0);
}

const releaseSection = `${unreleasedHeader}\n\n## [${version}] - ${today}\n\n${unreleasedBody}`;
const updated = nextSectionMatch
  ? `${content.slice(0, idx)}${releaseSection}\n\n${afterHeader.slice(nextSectionMatch.index + 1)}`
  : `${content.slice(0, idx)}${releaseSection}\n`;

fs.writeFileSync(changelogPath, updated, "utf8");

// Mirror into docs-site changelog page
const docsChangelogPath = path.join(repoRoot, "docs-site/src/content/docs/project/changelog.mdx");
if (fs.existsSync(docsChangelogPath)) {
  const fm = [
    "---",
    'title: "Changelog"',
    'description: "Notable changes to Patchwork following Keep a Changelog."',
    "---",
    "",
  ].join("\n");
  const stripped = updated.replace(/^#\s+Changelog\s*\n+/i, "");
  fs.writeFileSync(docsChangelogPath, `${fm}${stripped}`, "utf8");
}

console.log(`Released [${version}] - ${today} in CHANGELOG.md`);
