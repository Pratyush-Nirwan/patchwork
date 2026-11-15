# Embedded Documentation Plan (`/documentation`)

## 1. Current State (Inspected)

- **`docs-site/`**: Astro 5 + Starlight 0.34 documentation site with Pagefind search, `@astrojs/sitemap`, `starlight-links-validator`, custom SVG branding, and versioned footer (`Footer.astro`).
- **`next.config.ts`**: Standard Next.js 15 App Router build (`output` is not `'standalone'`), setting global security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`). No global CSP header is currently set.
- **`src/middleware.ts`**: Guards all non-static routes via `/api/setup/status` (redirecting incomplete setups to `/setup` and completed setups away from `/setup`) and protects `/dashboard/system`. Currently allowlists `/api/`, `/_next/`, and `/favicon.ico`.
- **Existing `/documentation` route**: None.
- **Reverse proxies (`deploy/Caddyfile`, `deploy/nginx.conf`)**: Proxy all traffic to `127.0.0.1:3000` with `flush_interval -1` (Caddy) and `proxy_buffering off` (Nginx).
- **Installer (`scripts/setup.mjs`, `scripts/setup/preflight.mjs`, `scripts/setup/repair.mjs`, `scripts/setup/state-detect.mjs`, `scripts/setup/server.mjs`)**: Runs `npm run build` during server startup; `--check` reports state table; `Repair` repairs `.env`, DB, MinIO, and services.

## 2. Chosen Approach

1. **Configurable Astro Base & Embedded Flags**:
   - `docs-site/astro.config.mjs` reads `DOCS_BASE` (default `/documentation` for embedded builds, configurable e.g. `/patchwork` for Pages), `DOCS_SITE_URL` (optional), and `DOCS_EMBEDDED` (`"true"` by default when `DOCS_BASE === "/documentation"`).
   - When embedded: adds `<meta name="robots" content="noindex" />`, a `"Back to Patchwork"` header link to `/`, and a tiny inline `is:inline` theme-sync script reading `localStorage.getItem("patchwork-theme")` inside `try/catch` before paint.
2. **Atomic Copy into `documentation-dist/`**:
   - `scripts/docs/copy-dist.mjs` builds `docs-site/dist` (or copies an existing `docs-site/dist`), verifies `index.html` and non-empty output, writes `documentation-dist/.build-info.json` (`{ version, base, builtAt }`), and atomically replaces `documentation-dist/` (staged in sibling temp dir + rename/swap). `documentation-dist/` is added to `.gitignore`.
   - Root `package.json`: `build` runs `npm run docs:build && npm run build:app`; `build:app` runs `next build`; `docs:build` runs `DOCS_BASE=/documentation` Astro build + `copy-dist.mjs`.
3. **Next.js Route Handler `src/app/documentation/[[...path]]/route.ts`**:
   - Supports `GET` and `HEAD`, strictly serving files from `documentation-dist/` (never `public/`).
   - Path safety: single URL decode, rejects null bytes, backslashes, double-encoded `%25` sequences, `..`, and absolute/drive paths; resolves with `path.resolve` + `fs.realpathSync` and verifies `resolved + path.sep` stays inside `rootReal + path.sep` (case-insensitive on Windows).
   - Redirects directory paths without a trailing slash (`/documentation/getting-started`) with `308` to `/documentation/getting-started/`. Serves `index.html` for `/` and directory indexes, and `404.html` with status `404` for missing paths.
   - Serves MIME types for `.html`, `.css`, `.js`, `.mjs`, `.json`, `.svg`, `.png`, `.jpg`, `.webp`, `.avif`, `.woff2`, `.ico`, `.xml`, `.txt`, `.wasm`, and Pagefind `.pf_index`/`.pf_meta`/`.pf_fragment`/`.pf_filter` (`application/octet-stream`).
   - Caching: `/_astro/` and `/pagefind/` get `Cache-Control: public, max-age=31536000, immutable`; HTML gets `Cache-Control: no-cache`, `ETag`, `Last-Modified`, and `304` on `If-None-Match` / `If-Modified-Since`.
   - Dev fallback: if `documentation-dist/` is missing in dev, returns a clean `200`/`503`-safe HTML message instructing `npm run docs:build` without crashing.
   - Embedded headers on `/documentation/**`: `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, and a scoped `Content-Security-Policy` allowing `'self'`, `'wasm-unsafe-eval'` (for Pagefind WASM), inline script SHA-256 hashes (for Starlight + theme-init inline scripts), `'unsafe-inline'` for Starlight inline styles, and `data:` for inline SVG/images.
4. **Middleware & Navigation**:
   - `src/middleware.ts` allowlists `/documentation` and `/documentation/` before setup and auth checks (no cookies read or set, no redirects to `/setup` or `/`).
   - Navigation links added in workspace sidebar footer (`PatchworkApp.tsx`), login page footer (`PatchworkApp.tsx`), Setup Wizard every step (`SetupWizard.tsx`), `/docs [topic]` slash command (`registry.ts` + `CommandPalette.tsx`), and a `"Documentation"` search result in `CommandPalette.tsx`.
5. **Installer, Proxies & Docs Enforcement**:
   - `state-detect.mjs`, `setup.mjs` (`--check` and Step 8 summary), `repair.mjs`, and `token.mjs` surface `documentation-dist/` build status, rebuild it during Repair if missing, and print the public `${APP_URL}/documentation` URL.
   - `deploy/Caddyfile` and `deploy/nginx.conf` document that `/documentation` routes through the app and SSE buffering rules do not restrict docs caching.
   - `scripts/docs/check.mjs` verifies that all internal links in `docs-site/dist` start with `DOCS_BASE` (when built) and checks `documentation-dist/` consistency.

## 3. Open Decisions Recorded

- **Authentication requirement for `/documentation`**: Default stays public (accessible before and after setup without cookies). Adding an optional "require login for docs" system setting is deferred and not implemented in v1.
