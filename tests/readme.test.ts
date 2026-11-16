import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderReadme } from "../scripts/docs/readme.mjs";
import { checkReadme } from "../scripts/docs/readme-check.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

function createTempRepoFixture() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "patchwork-readme-test-"));
  fs.mkdirSync(path.join(tmpRoot, "docs", "assets", "readme"), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, "website", "src", "content", "docs", "documentation", "reference"), {
    recursive: true,
  });

  // Copy minimal files needed by renderReadme & checkReadme
  for (const rel of [
    "package.json",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "AGENTS.md",
    "LICENSE",
    "docs/README.template.md",
    "website/src/content/docs/documentation/project/roadmap.mdx",
  ]) {
    const src = path.join(REPO_ROOT, rel);
    if (fs.existsSync(src)) {
      const dst = path.join(tmpRoot, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }

  // Copy README assets
  const assetsDir = path.join(REPO_ROOT, "docs", "assets", "readme");
  if (fs.existsSync(assetsDir)) {
    for (const file of fs.readdirSync(assetsDir)) {
      fs.copyFileSync(
        path.join(assetsDir, file),
        path.join(tmpRoot, "docs", "assets", "readme", file)
      );
    }
  }

  // Create minimal directories listed in project tree
  for (const dir of ["deploy", "drizzle", "e2e", "scripts", "src", "tests"]) {
    fs.mkdirSync(path.join(tmpRoot, dir), { recursive: true });
  }

  // Copy roadmap.yaml single source of truth
  const roadmapYamlDst = path.join(tmpRoot, "website", "src", "data", "roadmap.yaml");
  fs.mkdirSync(path.dirname(roadmapYamlDst), { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, "website", "src", "data", "roadmap.yaml"),
    roadmapYamlDst
  );

  // Copy website docs pages referenced in README.md
  for (const rel of [
    "website/src/content/docs/documentation/getting-started/installation.mdx",
    "website/src/content/docs/documentation/admin-guide/system-configuration.mdx",
    "website/src/content/docs/documentation/reference/command-palette.mdx",
    "website/src/content/docs/documentation/operations/troubleshooting.mdx",
    "website/src/content/docs/documentation/development/contributing-and-extending.mdx",
  ]) {
    const dst = path.join(tmpRoot, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, "# stub\n", "utf8");
  }

  fs.writeFileSync(path.join(tmpRoot, "README.md"), renderReadme(tmpRoot), "utf8");
  return tmpRoot;
}

function readWebpDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error(`Not a WebP file: ${filePath}`);
  }
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    return { width, height };
  }
  if (chunk === "VP8L") {
    const bits = buf.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  if (chunk === "VP8X") {
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width, height };
  }
  throw new Error(`Unsupported WebP chunk '${chunk}' in ${filePath}`);
}

describe("README generator, assets, and checks", () => {
  it("renderReadme is deterministic and idempotent", () => {
    const first = renderReadme(REPO_ROOT);
    const second = renderReadme(REPO_ROOT);
    expect(first).toBe(second);
  });

  it("checkReadme passes on the repository", () => {
    const errors = checkReadme(REPO_ROOT, { runMarkdownLint: true });
    expect(errors).toEqual([]);
  });

  it("light and dark logo and hero assets exist and screenshots meet size & dimension limits", () => {
    const assetsDir = path.join(REPO_ROOT, "docs", "assets", "readme");
    for (const svg of ["logo-light.svg", "logo-dark.svg"]) {
      const p = path.join(assetsDir, svg);
      expect(fs.existsSync(p), `Missing ${svg}`).toBe(true);
    }

    const screenshots = [
      "hero-board-light.webp",
      "hero-board-dark.webp",
      "ticket-panel-light.webp",
      "command-palette-light.webp",
      "search-light.webp",
      "system-config-dark.webp",
    ];
    for (const file of screenshots) {
      const p = path.join(assetsDir, file);
      expect(fs.existsSync(p), `Missing ${file}`).toBe(true);
      const stat = fs.statSync(p);
      expect(stat.size, `${file} exceeds 300 KB`).toBeLessThanOrEqual(300 * 1024);
      const dims = readWebpDimensions(p);
      expect(dims.width, `${file} width`).toBe(1600);
    }
  });

  it("checkReadme fails on outdated version, missing image, broken link, nonexistent script, and prohibited v1 feature", () => {
    const tmpRoot = createTempRepoFixture();
    try {
      expect(checkReadme(tmpRoot, { runMarkdownLint: false })).toEqual([]);

      // 1. Wrong version in README.md
      const readmePath = path.join(tmpRoot, "README.md");
      const baseReadme = fs.readFileSync(readmePath, "utf8");
      fs.writeFileSync(readmePath, baseReadme.replaceAll("v0.7.0-beta", "v0.6.0"), "utf8");
      const versionErrs = checkReadme(tmpRoot, { runMarkdownLint: false });
      expect(versionErrs.some((e) => e.includes("out of sync"))).toBe(true);
      expect(versionErrs.some((e) => e.includes("missing expected version"))).toBe(true);

      // 2. Missing image asset
      fs.writeFileSync(readmePath, baseReadme, "utf8");
      fs.unlinkSync(path.join(tmpRoot, "docs", "assets", "readme", "hero-board-light.webp"));
      const imgErrs = checkReadme(tmpRoot, { runMarkdownLint: false });
      expect(imgErrs.some((e) => e.includes("hero-board-light.webp"))).toBe(true);

      // 3. Broken relative link & broken anchor link
      fs.copyFileSync(
        path.join(REPO_ROOT, "docs", "assets", "readme", "hero-board-light.webp"),
        path.join(tmpRoot, "docs", "assets", "readme", "hero-board-light.webp")
      );
      fs.writeFileSync(
        readmePath,
        `${baseReadme}\n[Broken](docs/does-not-exist.md)\n[BadAnchor](#no-such-heading)\n`,
        "utf8"
      );
      const linkErrs = checkReadme(tmpRoot, { runMarkdownLint: false });
      expect(linkErrs.some((e) => e.includes("Broken README relative link"))).toBe(true);
      expect(linkErrs.some((e) => e.includes("Broken README anchor link"))).toBe(true);

      // 4. Nonexistent npm script
      fs.writeFileSync(
        readmePath,
        `${baseReadme}\n\`\`\`bash\nnpm run nonexistent:script\n\`\`\`\n`,
        "utf8"
      );
      const scriptErrs = checkReadme(tmpRoot, { runMarkdownLint: false });
      expect(scriptErrs.some((e) => e.includes("nonexistent:script"))).toBe(true);

      // 5. Prohibited v1 feature outside Status & Roadmap
      fs.writeFileSync(
        readmePath,
        baseReadme.replace(
          "## Quick Start",
          "## Quick Start\n\nIncludes built-in webhooks and SSO.\n"
        ),
        "utf8"
      );
      const featureErrs = checkReadme(tmpRoot, { runMarkdownLint: false });
      expect(featureErrs.some((e) => e.includes("prohibited v1 term"))).toBe(true);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
