# Patchwork Changelog Redesign Plan

## 1. Step 0 Inspection Findings (What Makes the Current Page Hard to Read)

Before screenshots captured at `C:/Users/praty/.gemini/antigravity/brain/c21e6821-e694-4294-9365-ce6fcbc883e9/scratch/changelog-before/` (`before-desktop-light.png`, `before-desktop-dark.png`, `before-mobile-light.png`, `before-mobile-dark.png`):

1. **Wall of dense bullets**: `v0.7.0-beta` is a single flat list of 13 multi-clause bullets under `### Added`, with no grouping by product area.
2. **Developer-internal noise**: Entries cite internal source paths (`src/lib/motion.ts`, `src/components/ui/motion.tsx`, `src/app/globals.css`, `src/components/skeletons/`) and internal symbol names (`RegionErrorBoundary`) instead of plain user-facing outcomes.
3. **No scannable summary or counts**: There are no `Highlights`, no `Upgrade notes`, no Beta/Stable badges, and no category counts.
4. **Weak release hierarchy**: `Unreleased` and `v0.7.0-beta` are stacked directly as underlined headings with no visual separation, and older releases do not have dedicated pages.
5. **Out-of-sync docs page**: `docs-site/src/content/docs/project/changelog.mdx` did not include the `Unreleased` entries from root `CHANGELOG.md`, had no RSS feed, and had no category/scope filtering.

## 2. Planned Fixes

- Define fixed product-area scopes in `docs-site/src/data/changelog-scopes.yaml`.
- Rewrite `CHANGELOG.md` entries in plain user/admin language (`**<Scope>:** ...`), sorted by scope order then alphabetically, with `### Highlights` and `### Upgrade notes` blocks.
- Generate `docs-site/src/content/docs/changelog/index.mdx` (overview with release cards, badges, highlights, counts, filter row, and RSS link), one page per release (`docs-site/src/content/docs/changelog/v0-7-0-beta.mdx` with scope badges, category icons, TOC, prev/next links, and progressive-enhancement JS filter), and `docs-site/public/changelog.xml` (RSS 2.0 feed).
- Enforce everything via `npm run changelog:check` (run by `docs:check` and `verify`), `release:prepare` tests, and Playwright visual + axe + Pagefind checks.

## 3. Content Fidelity Mapping (Before -> After)

All **4** `[Unreleased]` entries and **13** `[v0.7.0-beta]` entries were preserved 1-to-1 (0 entries dropped, 0 merged):

| Section | Original summary | Rewritten scope & summary | Meaning changed? |
| :--- | :--- | :--- | :--- |
| Unreleased | Added the v1.0.0 roadmap | **Documentation:** Added the v1.0.0 roadmap (`[docs](/project/roadmap/)`). | No |
| Unreleased | Easy Mode Installer (`npm run setup -- --easy`) | **Installer:** Added Easy mode as the default install path... | No |
| Unreleased | Process Supervisor (`scripts/supervisor.mjs`) | **Installer:** Added a process supervisor for `npm run start`, `npm run stop`, and `npm run status`... | No |
| Unreleased | Network Exposure & Offline Support | **Installer:** Added localhost vs. network exposure prompts, proxy support, and an offline cache route... | No |
| v0.7.0-beta | Cohesive motion system, skeletons, Reduce motion | **Performance:** Added shared UI motion primitives, geometry-matched skeleton loaders, error boundaries, and a Reduce motion toggle. | No |
| v0.7.0-beta | Embedded documentation serving at `/documentation` | **Documentation:** Added embedded documentation at `/documentation` with scoped CSP, caching, and standalone or embedded builds. | No |
| v0.7.0-beta | `/docs [topic]` and UI doc links | **Command bar:** Added `/docs [topic]` and a Documentation search entry, plus links from login, sidebar, setup wizard, and installer. | No |
| v0.7.0-beta | Official Starlight docs site and checks | **Documentation:** Added the Astro Starlight documentation site with generated references, coverage checks, and automated screenshots. | No |
| v0.7.0-beta | Root `SECURITY.md`, `CONTRIBUTING.md`, etc. | **Documentation:** Added security reporting, contributing guidelines, changelog, PR template, and automated docs publishing. | No |
| v0.7.0-beta | Single-source-of-truth versioning | **System Configuration:** Added single-source versioning (`v0.7.0-beta`), health version metadata, sidebar display, and upgrade checks. | No |
| v0.7.0-beta | Multi-team workspace, Kanban, Calendar | **Boards:** Added multi-team hierarchy, Kanban drag-and-drop with WIP gauges, and a Calendar view. | No |
| v0.7.0-beta | Native CLI installer, token, Setup Wizard | **Setup wizard:** Added the native CLI installer, encrypted one-time Admin Setup Token, and multi-step Setup Wizard with CSV import. | No |
| v0.7.0-beta | Server-enforced RBAC + sub-roles | **Security:** Added server-enforced RBAC with admin, lead, member, and viewer roles plus developer and tester sub-roles. | No |
| v0.7.0-beta | Spotlight Command Palette | **Command bar:** Added the Spotlight palette (`Ctrl+K` / `Cmd+K`) with slash commands, inline ghost hints, `/help`, and command history. | No |
| v0.7.0-beta | MinIO attachments & PostgreSQL FTS | **Search:** Added MinIO presigned file attachments with text extraction and scoped PostgreSQL full-text search. | No |
| v0.7.0-beta | Real-time board sync via LISTEN/NOTIFY & SSE | **Boards:** Added live board synchronization over PostgreSQL real-time notifications and Server-Sent Events. | No |
| v0.7.0-beta | System Configuration (`/dashboard/system`) | **System Configuration:** Added the admin dashboard for users, hierarchy, roles, security, storage, search, integrations, and data export. | No |

No new npm dependencies are required; Starlight's built-in components, plain CSS, and Node's built-in modules handle parsing, generation, filtering, and RSS XML output.
