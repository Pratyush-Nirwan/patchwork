# Patchwork Public Website & Documentation Plan (`website/`)

## 1. Cross-Boundary Dependencies Found & Replacements

| Previous Reference (in `docs-site/` or `scripts/docs/`) | Replacement |
| :--- | :--- |
| `docs-site/astro.config.mjs` importing `../scripts/lib/version.mjs` | Read `website/src/data/generated/app-meta.json` |
| `docs-site/src/components/Footer.astro` reading `../package.json` | Read `website/src/data/generated/app-meta.json` |
| `index.mdx` & `roadmap.mdx` importing `../../../../package.json` | Read `website/src/data/generated/app-meta.json` |
| `scripts/docs/extract.mjs` reading `src/`, `scripts/`, `drizzle/`, `.env.example`, `package.json` | Root `scripts/docs/export-data.mjs` (`npm run docs:export`) writes deterministic JSON snapshots + verbatim `CHANGELOG.md` into `website/src/data/generated/` |
| `scripts/docs/{generate,check,coverage,roadmap,changelog}.mjs` at root | Move into `website/scripts/` reading only `website/src/data/generated/*` and `website/src/data/*.yaml` |
| `scripts/docs/screenshots.mjs` writing to `docs-site/src/assets/screenshots/` | Root `scripts/docs/website-screenshots.mjs` (`npm run website:screenshots`) writes optimized `.webp` + silent `.webm` loops + posters to `website/src/assets/` |
| Root `package.json` `docs:*` scripts | Thin delegating aliases (`npm --prefix website run ...`, `node scripts/docs/export-data.mjs`, `node scripts/docs/build-embedded.mjs`) |

## 2. Design Direction & DFII

- **Purpose**: Persuade an engineering lead evaluating self-hosted ticketing to clone and run `npm run setup` within 60 seconds, and route them directly into `/documentation/` with zero friction.
- **Tone**: Industrial / Utilitarian + Editorial Restraint (no generic SaaS gradients, no glow blobs, no 3-column icon-card grids, no hype).
- **Differentiation Anchor**: The **Patchwork quilt/board motif** — crisp `1px`-bordered rectangular surfaces in warm paper (`#F6F5F2`) and slate ink (`#141920`), burnt-terracotta accent (`#C84317` / `#F05A28`), subtle tiled patch background grid, and a real interactive 4-column Kanban + `Ctrl+K` preview island.
- **DFII**: Impact `5` + Fit `5` + Feasibility `5` + Performance `5` − Consistency Risk `2` = **`18` (capped `13/15`, Excellent)**.
- **Palette** (`website/src/styles/tokens.css`, synced with `src/app/globals.css`):
  - Light: `--pw-bg: #F6F5F2`, `--pw-surface: #FFFFFF`, `--pw-surface-muted: #ECEAE4`, `--pw-ink: #141619`, `--pw-ink-secondary: #434B56`, `--pw-border: #D8D6D0`, `--pw-accent: #C84317`, `--pw-accent-hover: #AF3810`, `--pw-accent-soft: #FCECE6`.
  - Dark: `--pw-bg: #0D1014`, `--pw-surface: #13181E`, `--pw-surface-muted: #1A2129`, `--pw-ink: #EBF0F5`, `--pw-ink-secondary: #A6B2C0`, `--pw-border: #222A35`, `--pw-accent: #F05A28`, `--pw-accent-hover: #FF6E3D`, `--pw-accent-soft: #2D1A14`.
- **Typography** (OFL self-hosted via `@fontsource`, WOFF2, `font-display: swap`, tabular numbers):
  - Display: `Space Grotesk` (`@fontsource/space-grotesk`)
  - Body: `IBM Plex Sans` (`@fontsource/ibm-plex-sans`)
  - Mono: `JetBrains Mono` (`@fontsource/jetbrains-mono`)
- **Headline Candidates**:
  1. "Ticketing for engineering orgs that run their own stack." *(chosen — specific to audience and deployment model)*
  2. "Run your own ticketing platform. Three steps, no Docker."
  3. "Native, self-hosted ticketing for multi-team engineering."

## 3. Page Map & Build Targets

- **`BUILD_TARGET=website`** (default, configurable `SITE_BASE`, `SITE_URL`, `REPO_URL`):
  - `/` (`src/pages/index.astro`): Hero + 3-step OS-toggled install + board visual, Problem/Answer, Product Tour, Interactive Preview island (`<30 KB` gzipped, static fallback without JS), Self-hosted in minutes, For Admins, Under the hood SVG architecture, Roadmap teaser, Open source (AGPL-3.0), Accessible `<details>` FAQ, Closing CTA.
  - `/features/` (`src/pages/features.astro`): Full verified feature catalog generated from `src/data/features.yaml`.
  - `/get-started/` (`src/pages/get-started.astro`): 3-step install, prerequisites, link to `/documentation/getting-started/installation/` and `/documentation/getting-started/advanced-installation/`.
  - `/security/` (`src/pages/security.astro`): Security posture summary + link to `/documentation/operations/security/` and `SECURITY.md`.
  - `/license/` (`src/pages/license.astro`): Plain-language AGPL-3.0 summary + link to repository `LICENSE`.
  - `/404.html` (`src/pages/404.astro`): On-brand 404 with links to Home, Documentation, Features, Get started.
  - `/documentation/...`: Full Starlight docs collection (`src/content/docs/documentation/**`), Pagefind search, `/documentation/changelog/`, `/documentation/project/roadmap/`.
  - `/robots.txt` (`src/pages/robots.txt.ts`): Indexable for `website` target (`Sitemap:` included when `SITE_URL` set).
  - `/changelog.xml` (`public/changelog.xml`): RSS 2.0 feed.
- **`BUILD_TARGET=embedded`**:
  - Builds with `base: "/"`, `build.assets: "documentation/_astro"`, `noindex` meta tag, `"Back to Patchwork"` link, and `scripts/docs/copy-dist.mjs` copies `website/dist/documentation/` + `website/dist/pagefind/` + `changelog.xml` + `favicon.svg` + `og-image.svg` into root `documentation-dist/` (no marketing pages).

## 4. Assets & Copy Inventory

- `website/src/assets/screenshots/`: `board-{light,dark}.webp`, `ticket-panel-{light,dark}.webp`, `command-palette-{light,dark}.webp`, `system-config-{light,dark}.webp`, `roles-table-{light,dark}.webp`, `login-{light,dark}.webp` (all captured from `patchwork_test` seeded data).
- `website/src/assets/videos/`: optional silent WebM loops + WebP posters (`board-drag.webm`, `command-bar.webm`, `search-flow.webm`) under `1.2 MB` each, loaded only on view and disabled (`poster` only) under `prefers-reduced-motion`.
- `website/public/`: `favicon.svg`, `og-image.svg` (`1200x630`), `site.webmanifest`, `changelog.xml`, `_headers`.

## 5. Design Review Log

- **Round 1 (initial build)**: To be recorded after capturing `390`, `768`, `1280`, `1920` light/dark screenshots.
- **Round 2**: To be recorded after Round 1 fixes.
- **Round 3**: To be recorded after Round 2 fixes.

## 6. Open Questions for User Confirmation

- Final production `SITE_URL` / custom domain (`CNAME`) and hosting target (GitHub Pages vs Netlify/Cloudflare Pages vs self-hosted Caddy/Nginx).
- Canonical `REPO_URL` (`https://github.com/Pratyush-Nirwan/patchwork` used as default).
- Whether `website/` content/copy uses `AGPL-3.0-only` (matching root) or a separate docs license (`CC-BY-4.0`).
- Git LFS threshold if video recordings exceed repo size preferences (currently enforcing `< 1.2 MB` per video and `< 300 KB` per image).


## Design Review Loop (3 Rounds)

- **Round 1**: Inspected full-page renders at `390px`, `768px`, `1280px`, and `1920px` (light & dark). Found: (1) `[data-pw-reveal]` with initial `opacity: 0` left below-the-fold home sections hidden when unscrolled; (2) `.pw-hero-grid` and `.pw-os-grid` lacked `min-width: 0`, causing the terminal `<pre>` block to overflow horizontally (`520 > 390`, `998 > 768`, `1356 > 1280`) and cramp the hero headline; (3) `InteractivePreview` lacked `ArrowLeft`/`ArrowRight` keydown handlers on focused `.pw-card` elements.
- **Round 2**: Fixed all three issues (`opacity: 1` default on `[data-pw-reveal]`, `min-width: 0` + stacked `.pw-os-grid` in `.pw-hero-grid`, arrow-key card movement). Re-tested with Playwright + `@axe-core/playwright`: `0` horizontal overflows across all widths, `0` broken visible images, `0` external requests, `0` console errors, Pagefind search and no-JS fallback passed. `@axe-core/playwright` flagged `label-content-name-mismatch` on `#pw-theme-toggle` and `color-contrast` on `.pw-preview-badge` in light mode.
- **Round 3**: Updated `#pw-theme-toggle` to set matching `aria-label` (`Dark theme` / `Light theme`) and darkened `.pw-preview-badge` light-mode text to `#9e310d`. Re-verified: `0` axe violations on Home, Features, Get started, and 404; `0` external requests; `0` console errors; `0` overflows; `2242` raw JS bytes on Home (`< 60 KB` gzipped budget). (Starlight's built-in `button[data-open-modal]` search trigger on `/documentation/` retains Starlight's upstream `aria-label`.)
