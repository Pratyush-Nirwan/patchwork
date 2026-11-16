# Changelog

All notable changes to Patchwork are documented in this file. Read the scannable release pages in the [Patchwork Changelog docs](https://pratyush-nirwan.github.io/patchwork/changelog/) or check the [v1.0.0 Roadmap](docs-site/src/content/docs/project/roadmap.mdx) for upcoming work.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html), with a bold product scope tag at the start of every entry.

## [Unreleased]

## [v0.7.1-beta] - 2026-11-16

### Highlights
- You can now install Patchwork with only Node.js and git using the new Easy mode default.
- You can now manage PostgreSQL, MinIO, and the app together via `npm run start`, `npm run stop`, and `npm run status`.

### Added
- **Installer:** Added a process supervisor for `npm run start`, `npm run stop`, and `npm run status` with automatic crash recovery ([docs](/getting-started/quick-start/)).
- **Installer:** Added Easy mode as the default install path, auto-provisioning PostgreSQL 18 and MinIO with only Node.js and git ([docs](/getting-started/installation/)).
- **Installer:** Added localhost vs. network exposure prompts, proxy support, and an offline cache route for MinIO ([docs](/getting-started/installation/)).
- **Documentation:** Added project website and documentation package at `/documentation` ([docs](/introduction/overview/)).
- **Documentation:** Added the v1.0.0 roadmap ([docs](/project/roadmap/)).
## [v0.7.0-beta] - 2026-11-15

### Highlights
- You can now run Patchwork natively on Windows and Linux with multi-team Kanban boards, Calendar view, and real-time sync.
- You can now use the Spotlight command bar (`Ctrl+K` / `Cmd+K`) with slash commands, inline ghost hints, and scoped full-text search.
- You can now browse official documentation directly inside the app at `/documentation`.

### Upgrade notes
1. Back up your PostgreSQL database, `.env`, and MinIO data directory before upgrading ([docs](/operations/backups-and-upgrades/)).
2. Pull the release, install dependencies (`npm ci`), and apply database migrations (`npm run db:migrate`).
3. Rebuild and restart the server (`npm run build && npm run start`).

### Added
- **Boards:** Added live board synchronization over PostgreSQL real-time notifications and Server-Sent Events ([docs](/user-guide/workspace-and-boards/)).
- **Boards:** Added multi-team hierarchy, Kanban drag-and-drop with WIP gauges, and a Calendar view ([docs](/user-guide/workspace-and-boards/)).
- **Search:** Added MinIO presigned file attachments with text extraction and scoped PostgreSQL full-text search ([docs](/user-guide/search-and-filters/)).
- **Command bar:** Added `/docs [topic]` and a Documentation search entry, plus links from login, sidebar, setup wizard, and installer ([docs](/user-guide/command-palette/)).
- **Command bar:** Added the Spotlight palette (`Ctrl+K` / `Cmd+K`) with slash commands, inline ghost hints, `/help`, and command history ([docs](/user-guide/command-palette/)).
- **Setup wizard:** Added the native CLI installer, encrypted one-time Admin Setup Token, and multi-step Setup Wizard with CSV import ([docs](/getting-started/setup-wizard/)).
- **System Configuration:** Added single-source versioning (`v0.7.0-beta`), health version metadata, sidebar display, and upgrade checks ([docs](/operations/monitoring-and-maintenance/)).
- **System Configuration:** Added the admin dashboard for users, hierarchy, roles, security, storage, search, integrations, and data export ([docs](/admin-guide/system-configuration/)).
- **Security:** Added server-enforced RBAC with admin, lead, member, and viewer roles plus developer and tester sub-roles ([docs](/reference/roles-and-permissions/)).
- **Documentation:** Added embedded documentation at `/documentation` with scoped CSP, caching, and standalone or embedded builds ([docs](/introduction/overview/)).
- **Documentation:** Added security reporting, contributing guidelines, changelog, PR template, and automated docs publishing ([docs](/project/license-and-contributing/)).
- **Documentation:** Added the Astro Starlight documentation site with generated references, coverage checks, and automated screenshots ([docs](/introduction/overview/)).
- **Performance:** Added shared UI motion primitives, geometry-matched skeleton loaders, error boundaries, and a Reduce motion toggle ([docs](/user-guide/shortcuts-and-themes/)).

[Unreleased]: https://github.com/Pratyush-Nirwan/patchwork/compare/v0.7.1-beta...HEAD
[v0.7.1-beta]: https://github.com/Pratyush-Nirwan/patchwork/compare/v0.7.0-beta...v0.7.1-beta
[v0.7.0-beta]: https://github.com/Pratyush-Nirwan/patchwork/releases/tag/v0.7.0-beta
