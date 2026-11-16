import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkChangelog,
  loadChangelogScopes,
  parseChangelog,
  renderChangelogRss,
  renderReleasePage,
  validateChangelog,
} from "../website/scripts/changelog.mjs";
import { prepareRelease } from "../scripts/release-prepare.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const WEBSITE_ROOT = path.join(REPO_ROOT, "website");

const VALID_SAMPLE = `# Changelog

## [Unreleased]

## [v0.7.0-beta] - 2026-11-15

### Highlights
- You can now use Kanban boards cleanly.

### Added
- **Boards:** Added Kanban drag-and-drop ([docs](/user-guide/workspace-and-boards/)).

[Unreleased]: https://github.com/Pratyush-Nirwan/patchwork/compare/v0.7.0-beta...HEAD
[v0.7.0-beta]: https://github.com/Pratyush-Nirwan/patchwork/releases/tag/v0.7.0-beta
`;

describe("Changelog parser, validator, generator, and release roll", () => {
  it("passes checkChangelog on the committed repository", () => {
    expect(checkChangelog(WEBSITE_ROOT)).toEqual([]);
  });

  it("rejects malformed headers, unknown categories, empty categories, missing/unknown scopes, and invalid dates/versions", () => {
    const scopes = loadChangelogScopes(WEBSITE_ROOT);

    expect(() =>
      parseChangelog("# Changelog\n\n## v0.7.0-beta - 2026-11-15\n", { scopes })
    ).toThrow(/Malformed release header/);

    expect(() =>
      parseChangelog("# Changelog\n\n## [v0.7.0-beta] - 2026-11-15\n\n### Misc\n- **Boards:** Hi.\n", { scopes })
    ).toThrow(/Unknown category/);

    expect(() =>
      parseChangelog("# Changelog\n\n## [v0.7.0-beta] - 2026-11-15\n\n### Added\n- No scope here.\n", { scopes })
    ).toThrow(/missing bold scope tag/);

    expect(() =>
      parseChangelog("# Changelog\n\n## [v0.7.0-beta] - 2026-11-15\n\n### Added\n- **UnknownScope:** Bad.\n", { scopes })
    ).toThrow(/Unknown scope/);

    const badDate = parseChangelog(VALID_SAMPLE.replace("2026-11-15", "2026-02-30"), { scopes });
    expect(
      validateChangelog(badDate, { websiteRoot: WEBSITE_ROOT, scopes, expectedCurrentVersion: "v0.7.0-beta" }).some((e) =>
        e.includes("Invalid date")
      )
    ).toBe(true);

    const noV = parseChangelog(VALID_SAMPLE.replaceAll("v0.7.0-beta", "0.7.0-beta"), { scopes });
    expect(
      validateChangelog(noV, { websiteRoot: WEBSITE_ROOT, scopes, expectedCurrentVersion: "v0.7.0-beta" }).some((e) =>
        e.includes("must use v-prefixed SemVer")
      )
    ).toBe(true);

    const emptyCat = parseChangelog(
      "# Changelog\n\n## [v0.7.0-beta] - 2026-11-15\n\n### Added\n",
      { scopes }
    );
    expect(
      validateChangelog(emptyCat, { websiteRoot: WEBSITE_ROOT, scopes, expectedCurrentVersion: "v0.7.0-beta" }).some((e) =>
        e.includes("Empty category")
      )
    ).toBe(true);
  });

  it("rejects out-of-order releases, >200 char entries, commit hashes, file paths, planned items, broken [docs] links, and unrepeated Breaking entries", () => {
    const scopes = loadChangelogScopes(WEBSITE_ROOT);

    const outOfOrder = parseChangelog(
      `# Changelog\n\n## [v0.6.0] - 2026-10-01\n\n### Added\n- **Boards:** Older.\n\n## [v0.7.0-beta] - 2026-11-15\n\n### Added\n- **Boards:** Newer.\n\n[v0.6.0]: https://example.com/v0.6.0\n[v0.7.0-beta]: https://example.com/v0.7.0-beta\n`,
      { scopes }
    );
    expect(
      validateChangelog(outOfOrder, { websiteRoot: WEBSITE_ROOT, scopes, expectedCurrentVersion: "v0.6.0" }).some((e) =>
        e.includes("out of order")
      )
    ).toBe(true);

    const longEntry = `- **Boards:** ${"a".repeat(205)}`;
    const tooLong = parseChangelog(
      VALID_SAMPLE.replace("- **Boards:** Added Kanban drag-and-drop ([docs](/user-guide/workspace-and-boards/)).", longEntry),
      { scopes }
    );
    expect(
      validateChangelog(tooLong, { websiteRoot: WEBSITE_ROOT, scopes, expectedCurrentVersion: "v0.7.0-beta" }).some((e) =>
        e.includes("exceeds 200 characters")
      )
    ).toBe(true);

    const withHash = parseChangelog(
      VALID_SAMPLE.replace("Added Kanban drag-and-drop", "Added Kanban drag-and-drop in a1b2c3d"),
      { scopes }
    );
    expect(
      validateChangelog(withHash, { websiteRoot: WEBSITE_ROOT, scopes, expectedCurrentVersion: "v0.7.0-beta" }).some((e) =>
        e.includes("commit hash")
      )
    ).toBe(true);

    const withFile = parseChangelog(
      VALID_SAMPLE.replace("Added Kanban drag-and-drop", "Updated src/components/PatchworkApp.tsx"),
      { scopes }
    );
    expect(
      validateChangelog(withFile, { websiteRoot: WEBSITE_ROOT, scopes, expectedCurrentVersion: "v0.7.0-beta" }).some((e) =>
        e.includes("internal file path")
      )
    ).toBe(true);

    const withPlanned = parseChangelog(
      VALID_SAMPLE.replace("Added Kanban drag-and-drop", "Added Sprints and cycles"),
      { scopes }
    );
    expect(
      validateChangelog(withPlanned, {
        websiteRoot: WEBSITE_ROOT,
        scopes,
        expectedCurrentVersion: "v0.7.0-beta",
        plannedTitles: ["Sprints and cycles"],
      }).some((e) => e.includes("planned roadmap item"))
    ).toBe(true);

    const brokenDoc = parseChangelog(
      VALID_SAMPLE.replace("/user-guide/workspace-and-boards/", "/nonexistent-page/"),
      { scopes }
    );
    expect(
      validateChangelog(brokenDoc, { websiteRoot: WEBSITE_ROOT, scopes, expectedCurrentVersion: "v0.7.0-beta" }).some((e) =>
        e.includes("Broken [docs]")
      )
    ).toBe(true);

    const unrepeatedBreaking = parseChangelog(
      VALID_SAMPLE.replace("- **Boards:**", "- **Breaking:** **Boards:**"),
      { scopes }
    );
    expect(
      validateChangelog(unrepeatedBreaking, {
        websiteRoot: WEBSITE_ROOT,
        scopes,
        expectedCurrentVersion: "v0.7.0-beta",
      }).some((e) => e.includes("Breaking entry must be repeated in ### Upgrade notes"))
    ).toBe(true);
  });

  it("renders Highlights, Upgrade notes, and Breaking callouts only when present and produces valid RSS XML", () => {
    const scopes = loadChangelogScopes(WEBSITE_ROOT);
    const parsed = parseChangelog(VALID_SAMPLE, { scopes });
    const mdx = renderReleasePage(parsed.releases[1], 1, parsed.releases);
    expect(mdx).toContain('title="Highlights"');
    expect(mdx).not.toContain('title="Upgrade notes"');
    expect(mdx).not.toContain('title="Breaking changes"');

    const rss = renderChangelogRss(parsed, "https://pratyush-nirwan.github.io/patchwork");
    expect(rss).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(rss).toContain('<rss version="2.0">');
    expect(rss).toContain("<title>Patchwork v0.7.0-beta</title>");
    expect(rss).toContain("<link>https://pratyush-nirwan.github.io/patchwork/documentation/changelog/v0-7-0-beta/</link>");
  });

  it("rolls Unreleased into a new release via release:prepare while preserving Highlights and Upgrade notes", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pw-rel-changelog-"));
    try {
      for (const rel of [
        "package.json",
        "CHANGELOG.md",
        "README.md",
        ".env.example",
        "docs/README.template.md",
        "src/lib/shortcuts.ts",
        "src/lib/rbac.ts",
        "src/lib/settings.ts",
        "src/lib/commands/registry.ts",
        "src/db/schema.ts",
        "scripts/setup.mjs",
        "website/package.json",
        "website/src/data/changelog-scopes.yaml",
        "website/src/data/roadmap.yaml",
      ]) {
        const src = path.join(REPO_ROOT, rel);
        const dst = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        if (fs.existsSync(src)) fs.copyFileSync(src, dst);
      }
      fs.mkdirSync(path.join(tmp, "src/app/api/health"), { recursive: true });
      fs.cpSync(
        path.join(REPO_ROOT, "website/src/content/docs"),
        path.join(tmp, "website/src/content/docs"),
        { recursive: true }
      );

      const res = prepareRelease({
        repoRoot: tmp,
        targetVersion: "0.8.0",
        syncLockfiles: false,
        runChecks: false,
        today: "2026-12-01",
      });
      expect(res.displayVersion).toBe("v0.8.0");
      expect(res.commands.some((c) => c.includes("v0.8.0"))).toBe(true);

      const updatedCl = fs.readFileSync(path.join(tmp, "CHANGELOG.md"), "utf8");
      expect(updatedCl).toContain("## [v0.8.0] - 2026-12-01");
      expect(updatedCl).toContain("### Highlights");
      expect(fs.existsSync(path.join(tmp, "website/src/content/docs/documentation/changelog/v0-8-0.mdx"))).toBe(true);
      expect(checkChangelog(path.join(tmp, "website"))).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
