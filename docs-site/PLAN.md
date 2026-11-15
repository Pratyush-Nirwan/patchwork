# Patchwork Documentation Site Plan

## 1. Decisions Recorded

- **Site URL & Hosting Target**: Self-hosted static output (`site: "https://docs.patchwork.example.com"`, `base: "/"`). `.github/workflows/docs.yml` runs the Windows + Linux build and `docs:check` matrix and uploads `docs-site/dist` as a workflow artifact; no GitHub Pages deployment.
- **Versioning**: Single current version shown in the site footer, read from root `package.json` (`version`). No per-release versioned doc snapshots (`starlight-versions` not added).
- **Logo & Branding**: Custom geometric SVG logo + Patchwork wordmark using the app's design tokens (`#C84317` light / `#F05A28` dark accent, `#141920` dispatch rail, `#F6F5F2` drafting paper).
- **Repository Slug**: Placeholder `owner/patchwork` used for "Edit this page" links, `CONTRIBUTING.md`, and `SECURITY.md` until a git remote is configured.
- **Git Last-Updated Dates**: `lastUpdated: true` enabled in Starlight. Because this workspace currently has no `.git` history, Starlight falls back cleanly when git metadata is unavailable and displays git timestamps once committed in a git repository.

## 2. Packages Added to `docs-site/`

All documentation dependencies live strictly in `docs-site/package.json` (never in root `package.json` dependencies) so the Next.js app bundle and runtime are untouched:

| Package | Role | Reason |
|---|---|---|
| `astro` | Static site generator | Required core framework for Starlight |
| `@astrojs/starlight` | Documentation theme | Provides sidebar, Pagefind search, light/dark themes, edit links, i18n/tabs/callouts |
| `@astrojs/sitemap` | Sitemap integration | Generates `sitemap-index.xml` for static hosting |
| `starlight-links-validator` | Dev link checker | Validates internal links, anchors, and asset references during `docs:build` |
| `sharp` | Image processor | Astro asset optimization for screenshots and Open Graph image |

## 3. Existing Docs Migration Map

| Existing File | Destination | Action |
|---|---|---|
| `docs/INSTALL.md` | `docs-site/src/content/docs/getting-started/installation.mdx` | Migrate content; replace `docs/INSTALL.md` with one-line stub |
| `docs/SEEDING.md` | `docs-site/src/content/docs/development/seeding.mdx` | Migrate content; replace `docs/SEEDING.md` with one-line stub |
| `docs/CROSS_PLATFORM.md` | `docs-site/src/content/docs/development/cross-platform.mdx` | Migrate content; replace `docs/CROSS_PLATFORM.md` with one-line stub |
| `docs/COMMAND_PALETTE.md` | `docs-site/src/content/docs/user-guide/command-palette.mdx` + generated `reference/command-palette.mdx` | Migrate content; replace `docs/COMMAND_PALETTE.md` with one-line stub |
| `docs/COMMAND_PALETTE_PLAN.md` | `docs/internal/COMMAND_PALETTE_PLAN.md` | Move to `docs/internal/` (unpublished) |
| `docs/CROSS_PLATFORM_AUDIT.md` | `docs/internal/CROSS_PLATFORM_AUDIT.md` | Move to `docs/internal/` (unpublished) |
| `docs/QA_REPORT.md` | `docs/internal/QA_REPORT.md` | Move to `docs/internal/` (unpublished) |
| `docs/QA_SPEC_CHECKLIST.md` | `docs/internal/QA_SPEC_CHECKLIST.md` | Move to `docs/internal/` (unpublished) |
| `docs/SLASH_FIXES_PLAN.md` | `docs/internal/SLASH_FIXES_PLAN.md` | Move to `docs/internal/` (unpublished) |
| `docs/SLASH_HINTS_PLAN.md` | `docs/internal/SLASH_HINTS_PLAN.md` | Move to `docs/internal/` (unpublished) |
| `docs/SYSTEM_CONFIG_PLAN.md` | `docs/internal/SYSTEM_CONFIG_PLAN.md` | Move to `docs/internal/` (unpublished) |

## 4. Target Information Architecture (`docs-site/src/content/docs/`)

- `index.mdx` — Custom landing page (pitch, Get started CTA, feature highlights, screenshots)
- `introduction/` — `overview.mdx` (concepts, roles, architecture diagram, glossary)
- `getting-started/` — `quick-start.mdx`, `installation.mdx`, `setup-wizard.mdx`, `domain-and-https.mdx`
- `user-guide/` — `workspace-and-boards.mdx`, `tickets-and-collaboration.mdx`, `attachments-and-links.mdx`, `search-and-filters.mdx`, `command-palette.mdx`, `shortcuts-and-themes.mdx`
- `admin-guide/` — `system-configuration.mdx`, `user-management.mdx`, `sessions-and-security-policy.mdx`
- `reference/` — generated & authoritative references:
  - `command-palette.mdx` (generated from `src/lib/commands/registry.ts` + `src/lib/shortcuts.ts`)
  - `roles-and-permissions.mdx` (generated from `src/lib/rbac.ts`)
  - `configuration.mdx` (generated from `.env.example` + `src/lib/settings.ts`)
  - `database-schema.mdx` (generated from `src/db/schema.ts`)
  - `installer-cli.mdx` (generated from `scripts/setup.mjs`)
- `operations/` — `monitoring-and-maintenance.mdx`, `backups-and-upgrades.mdx`, `security.mdx`, `troubleshooting.mdx`
- `development/` — `local-setup.mdx`, `seeding.mdx`, `cross-platform.mdx`, `contributing-and-extending.mdx`, `architecture.mdx`
- `project/` — `changelog.mdx`, `roadmap.mdx`, `license-and-contributing.mdx`

## 5. Automation & Enforcement

- `scripts/docs/generate.mjs` (`npm run docs:generate`): Generates the 5 reference pages + partials with `Generated file, do not edit` header.
- `scripts/docs/coverage.mjs` + `scripts/docs/check.mjs` (`npm run docs:check`):
  1. Re-runs generator into a temp dir and fails on any diff with committed files.
  2. Verifies 100% coverage of slash commands, env vars, system settings, permissions, installer flags, and top-level API route groups (and fails on stale documented items missing from code).
  3. Verifies frontmatter (`title`, `description`), runnable `npm run <script>` commands against `package.json`, referenced screenshot paths, and referenced repo file paths.
- `scripts/docs/screenshots.mjs` (`npm run docs:screenshots`): Playwright capture against `patchwork_test` seeded with `npm run seed -- --size small` (light & dark).
- `scripts/docs/release.mjs` (`npm run release:docs`): Moves `CHANGELOG.md` `Unreleased` items into a dated version header.
- Negative test in `tests/docs-enforcement.test.ts` proving `coverage.mjs` fails when an undocumented command is added to a fixture registry.
