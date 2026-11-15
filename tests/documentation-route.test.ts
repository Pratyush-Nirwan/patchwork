import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDocsCsp,
  getDocsMimeType,
  sanitizeDocsSegments,
  serveDocsRequest,
} from "@/lib/docs-server";
import { copyDocsDist } from "../scripts/docs/copy-dist.mjs";
import { detectInstallState, formatStateTable } from "../scripts/setup/state-detect.mjs";

const REPO_ROOT = process.cwd();
const REAL_DOCS_DIST = path.join(REPO_ROOT, "documentation-dist");

function collectAllFiles(dir: string, relBase = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectAllFiles(full, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

describe("Embedded Documentation Route & Security", () => {
  it("serves /documentation landing page with scoped CSP, noindex, ETag, and no-cache", async () => {
    const req = new Request("http://localhost:3000/documentation");
    const res = serveDocsRequest(req, undefined, REAL_DOCS_DIST);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("etag")).toBeTruthy();

    const csp = res.headers.get("content-security-policy") || "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).toContain("'sha256-");
    expect(csp).toContain("frame-ancestors 'none'");

    const html = await res.text();
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain('href="/"');
    expect(html).toContain("Back to Patchwork");
  });

  it("serves directory URLs both with and without trailing slash as 200", () => {
    const noSlash = serveDocsRequest(
      new Request("http://localhost:3000/documentation/getting-started/quick-start?foo=bar"),
      ["getting-started", "quick-start"],
      REAL_DOCS_DIST
    );
    expect(noSlash.status).toBe(200);
    expect(noSlash.headers.get("content-type")).toBe("text/html; charset=utf-8");

    const withSlash = serveDocsRequest(
      new Request("http://localhost:3000/documentation/getting-started/quick-start/"),
      ["getting-started", "quick-start"],
      REAL_DOCS_DIST
    );
    expect(withSlash.status).toBe(200);
    expect(withSlash.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("supports 304 Not Modified via ETag and HEAD requests with empty body", async () => {
    const first = serveDocsRequest(
      new Request("http://localhost:3000/documentation"),
      undefined,
      REAL_DOCS_DIST
    );
    const etag = first.headers.get("etag")!;
    const conditional = serveDocsRequest(
      new Request("http://localhost:3000/documentation", {
        headers: { "If-None-Match": etag },
      }),
      undefined,
      REAL_DOCS_DIST
    );
    expect(conditional.status).toBe(304);

    const headRes = serveDocsRequest(
      new Request("http://localhost:3000/documentation", { method: "HEAD" }),
      undefined,
      REAL_DOCS_DIST
    );
    expect(headRes.status).toBe(200);
    expect(headRes.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await headRes.text()).toBe("");
  });

  it("serves 404.html with 404 status for missing pages", async () => {
    const res = serveDocsRequest(
      new Request("http://localhost:3000/documentation/does-not-exist/"),
      ["does-not-exist"],
      REAL_DOCS_DIST
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const body = await res.text();
    expect(body.length).toBeGreaterThan(100);
  });

  it("rejects all path traversal and encoding abuse vectors with 400", () => {
    const badVectors: string[][] = [
      [".."],
      ["getting-started", "..", "..", "package.json"],
      ["%2e%2e", "package.json"],
      ["%252e%252e", "package.json"],
      ["foo%2fbar"],
      ["foo%5cbar"],
      ["foo%00bar"],
      ["a\\b"],
      ["C:Windows"],
      ["."],
    ];
    for (const segs of badVectors) {
      expect(sanitizeDocsSegments(segs)).toBeNull();
      const res = serveDocsRequest(
        new Request("http://localhost:3000/documentation/bad"),
        segs,
        REAL_DOCS_DIST
      );
      expect(res.status).toBe(400);
    }
  });

  it("blocks symlink escapes pointing outside documentation-dist", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pw-docs-symlink-"));
    try {
      const docsRoot = path.join(tmp, "docs");
      const outside = path.join(tmp, "secret.txt");
      fs.mkdirSync(docsRoot, { recursive: true });
      fs.writeFileSync(path.join(docsRoot, "index.html"), "<html></html>", "utf8");
      fs.writeFileSync(outside, "TOP_SECRET", "utf8");

      const linkPath = path.join(docsRoot, "escape.txt");
      try {
        fs.symlinkSync(outside, linkPath);
      } catch {
        // OS (e.g., Windows without Developer Mode) refused symlink creation; skip cleanly
        return;
      }

      const res = serveDocsRequest(
        new Request("http://localhost:3000/documentation/escape.txt"),
        ["escape.txt"],
        docsRoot
      );
      expect(res.status).toBe(404);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("serves every file in documentation-dist with valid MIME types and immutable cache for _astro/pagefind", () => {
    const files = collectAllFiles(REAL_DOCS_DIST).filter((f) => f !== ".build-info.json");
    expect(files.length).toBeGreaterThan(20);

    for (const rel of files) {
      const segs = rel.split("/");
      const res = serveDocsRequest(
        new Request(`http://localhost:3000/documentation/${rel}`, { method: "HEAD" }),
        segs,
        REAL_DOCS_DIST
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(getDocsMimeType(rel));
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
      if (segs[0] === "_astro" || segs[0] === "pagefind") {
        expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      }
    }
  });

  it("returns 503 fallback when documentation-dist is missing in dev", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-docs-empty-"));
    try {
      const res = serveDocsRequest(
        new Request("http://localhost:3000/documentation"),
        undefined,
        emptyDir
      );
      expect(res.status).toBe(503);
      expect(await res.text()).toBe("Docs not built. Run npm run docs:build.");
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("copyDocsDist atomically copies docs-site output and writes .build-info.json", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pw-copy-dist-"));
    try {
      const src = path.join(tmp, "dist");
      const dst = path.join(tmp, "documentation-dist");
      fs.mkdirSync(src, { recursive: true });
      fs.writeFileSync(path.join(src, "index.html"), "<h1>Hi</h1>", "utf8");
      fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ version: "1.2.3" }));

      const info = copyDocsDist({
        repoRoot: tmp,
        sourceDir: src,
        targetDir: dst,
        base: "/documentation",
      });
      expect(info.version).toBe("1.2.3");
      expect(info.base).toBe("/documentation");
      expect(fs.existsSync(path.join(dst, "index.html"))).toBe(true);
      expect(fs.existsSync(path.join(dst, ".build-info.json"))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("middleware.ts bypasses auth/setup redirects for /documentation", () => {
    const mw = fs.readFileSync(path.join(REPO_ROOT, "src/middleware.ts"), "utf8");
    expect(mw).toContain('pathname === "/documentation"');
    expect(mw).toContain('pathname.startsWith("/documentation/")');
  });

  it("installer state-detect reports embedded documentation status", async () => {
    const state = await detectInstallState({ projectDir: REPO_ROOT });
    expect(state.docs.built).toBe(true);
    expect(state.docs.base).toBe("/documentation");
    const table = formatStateTable(state);
    expect(table).toContain("Embedded documentation");
    expect(table).toContain("base=/documentation");
  });

  it("buildDocsCsp hashes inline scripts and skips external src scripts", () => {
    const csp = buildDocsCsp(
      '<html><head><script src="/documentation/_astro/app.js"></script><script>console.log(1);</script></head></html>'
    );
    expect(csp).toContain("'sha256-");
    expect(csp).not.toContain("'unsafe-inline'\n");
  });
});
