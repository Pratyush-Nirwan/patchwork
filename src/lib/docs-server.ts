import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

export const DEFAULT_DOCS_DIST_DIR = path.resolve(process.cwd(), "documentation-dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".pf_index": "application/octet-stream",
  ".pf_meta": "application/octet-stream",
  ".pf_fragment": "application/octet-stream",
  ".pf_filter": "application/octet-stream",
  ".pagefind": "application/octet-stream",
};

export function getDocsMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

export function isImmutableDocsAsset(relativeSegments: string[]): boolean {
  const first = relativeSegments[0];
  return first === "_astro" || first === "pagefind";
}

/**
 * Validates and single-decodes URL path segments for static docs serving.
 * Returns null when any traversal, encoding abuse, or invalid segment is detected.
 */
export function sanitizeDocsSegments(rawSegments: string[] | undefined): string[] | null {
  if (!rawSegments || rawSegments.length === 0) {
    return [];
  }

  const decoded: string[] = [];
  for (const raw of rawSegments) {
    if (!raw) continue;
    // Reject double-encoding (%25), encoded slashes (%2f / %5c), or null bytes (%00)
    if (/%(25|2f|5c|00)/i.test(raw)) {
      return null;
    }

    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }

    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      segment.includes("..") ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment.includes("\0") ||
      /^[a-zA-Z]:/.test(segment)
    ) {
      return null;
    }

    decoded.push(segment);
  }

  return decoded;
}

export function resolveSafeDocsFile(
  docsRoot: string,
  segments: string[]
): { kind: "file"; filePath: string; stat: fs.Stats } | { kind: "redirect-slash" } | { kind: "not-found" } {
  if (!fs.existsSync(docsRoot)) {
    return { kind: "not-found" };
  }

  const realRoot = fs.realpathSync(docsRoot);
  const candidate = path.resolve(realRoot, ...segments);

  // Fast lexical containment check
  if (candidate !== realRoot && !candidate.startsWith(realRoot + path.sep)) {
    return { kind: "not-found" };
  }

  if (!fs.existsSync(candidate)) {
    return { kind: "not-found" };
  }

  const realCandidate = fs.realpathSync(candidate);
  if (realCandidate !== realRoot && !realCandidate.startsWith(realRoot + path.sep)) {
    return { kind: "not-found" };
  }

  const stat = fs.statSync(realCandidate);
  if (stat.isDirectory()) {
    const indexPath = path.join(realCandidate, "index.html");
    if (!fs.existsSync(indexPath)) {
      return { kind: "not-found" };
    }
    const realIndex = fs.realpathSync(indexPath);
    if (!realIndex.startsWith(realRoot + path.sep)) {
      return { kind: "not-found" };
    }
    return { kind: "file", filePath: realIndex, stat: fs.statSync(realIndex) };
  }

  if (stat.isFile()) {
    return { kind: "file", filePath: realCandidate, stat };
  }

  return { kind: "not-found" };
}

export function computeInlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>();
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    // Skip external scripts with src=
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (!body) continue;
    const digest = crypto.createHash("sha256").update(body, "utf8").digest("base64");
    hashes.add(`'sha256-${digest}'`);
  }
  return [...hashes];
}

export function buildDocsCsp(html?: string): string {
  const hashes = html ? computeInlineScriptHashes(html) : [];
  const scriptSrc = ["'self'", "'wasm-unsafe-eval'", ...hashes].join(" ");
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function buildEtag(stat: fs.Stats): string {
  return `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

function isNotModified(request: Request, etag: string, mtimeMs: number): boolean {
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch) {
    const tags = ifNoneMatch.split(",").map((t) => t.trim());
    if (tags.includes("*") || tags.includes(etag)) {
      return true;
    }
  }

  const ifModifiedSince = request.headers.get("if-modified-since");
  if (ifModifiedSince) {
    const parsed = Date.parse(ifModifiedSince);
    if (!Number.isNaN(parsed) && Math.floor(mtimeMs / 1000) * 1000 <= parsed) {
      return true;
    }
  }

  return false;
}

export function serveDocsRequest(
  request: Request,
  rawSegments: string[] | undefined,
  docsRoot: string = DEFAULT_DOCS_DIST_DIR
): Response {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex",
      },
    });
  }

  const rootIndex = path.join(docsRoot, "index.html");
  if (!fs.existsSync(docsRoot) || !fs.existsSync(rootIndex)) {
    return new Response("Docs not built. Run npm run docs:build.", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex",
      },
    });
  }

  const segments = sanitizeDocsSegments(rawSegments);
  if (segments === null) {
    return new Response("Bad Request", {
      status: 400,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex",
      },
    });
  }

  const resolved = resolveSafeDocsFile(docsRoot, segments);

  if (resolved.kind === "file") {
    return buildFileResponse(request, resolved.filePath, resolved.stat, segments, 200);
  }

  // Fallback to 404.html if present
  const notFoundPath = path.join(docsRoot, "404.html");
  if (fs.existsSync(notFoundPath)) {
    const realRoot = fs.realpathSync(docsRoot);
    const real404 = fs.realpathSync(notFoundPath);
    if (real404.startsWith(realRoot + path.sep)) {
      return buildFileResponse(request, real404, fs.statSync(real404), ["404.html"], 404);
    }
  }

  return new Response("Not Found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}

function buildFileResponse(
  request: Request,
  filePath: string,
  stat: fs.Stats,
  segments: string[],
  status: number
): Response {
  const mimeType = getDocsMimeType(filePath);
  const isHtml = path.extname(filePath).toLowerCase() === ".html";
  const etag = buildEtag(stat);
  const lastModified = new Date(stat.mtimeMs).toUTCString();

  const cacheControl = isHtml
    ? "no-cache"
    : isImmutableDocsAsset(segments)
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600";

  const headers = new Headers({
    "Content-Type": mimeType,
    "Cache-Control": cacheControl,
    ETag: etag,
    "Last-Modified": lastModified,
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
  });

  if (status === 200 && isHtml && isNotModified(request, etag, stat.mtimeMs)) {
    return new Response(null, { status: 304, headers });
  }

  if (isHtml) {
    const html = fs.readFileSync(filePath, "utf8");
    headers.set("Content-Security-Policy", buildDocsCsp(html));
    if (request.method.toUpperCase() === "HEAD") {
      return new Response(null, { status, headers });
    }
    return new Response(html, { status, headers });
  }

  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status, headers });
  }

  const nodeStream = fs.createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  return new Response(webStream, { status, headers });
}
