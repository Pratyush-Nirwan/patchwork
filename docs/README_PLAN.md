# Patchwork README Plan

## Current README Problems
1. **No visual identity or preview**: Lacks a logo/wordmark, quick links, hero screenshot, or architecture diagram.
2. **Deployment-heavy opening**: Jumps straight into local dev commands and reverse proxy configs without explaining what Patchwork is, its features, or why to use it.
3. **Hardcoded/unverified drift risk**: Version badge was added manually; no template/generator or automated check validates commands against `package.json`, links, images, or v1 out-of-scope claims.
4. **Missing sections**: No Table of Contents, Features overview, Tech Stack, Project Structure, Beta status / Known Limitations, Contributing, or Security section.

## Planned Structure (< 250 lines)
1. **Header block** (centered HTML): Light/dark `<picture>` wordmark SVG, tagline, one-sentence description, single row of static badges (`v0.7.0-beta`, `AGPL-3.0`, `Node >=20`, `Windows | Linux`, `beta`), quick-links row.
2. **Hero & Gallery**: Kanban board `<picture>` (light/dark, 1600px) + collapsible `<details>` gallery (Setup Wizard, Command Palette + slash commands, Ticket Panel, Search, System Configuration).
3. **Table of Contents**
4. **Why Patchwork**: 4 concise points (AGPL-3.0 self-hosted, `Org -> Teams -> Projects -> Boards`, native zero-Docker, dense Jira-style UI + Spotlight command bar).
5. **Features**: Verified capabilities grouped by domain (Boards & tickets, Real-time, Search, Command bar, Access control, Attachments, GitHub/GitLab links, Operations, Cross-platform).
6. **Quick start**: Compact prerequisites list + Windows (PowerShell) and Linux (bash) labeled `<details>` blocks with copy-paste commands (`git clone`, `npm ci`, `npm run setup`, one-time Admin Setup Token note, `/setup` wizard).
7. **Documentation**: Links to `https://pratyush-nirwan.github.io/patchwork/`, in-app `/documentation`, Installation, Admin guide, Command reference, Troubleshooting.
8. **Architecture & Tech stack**: Mermaid diagram (Browser, Next.js App Router, PostgreSQL + `LISTEN/NOTIFY` + FTS, MinIO, SSE) + compact Tech Stack table.
9. **Project structure**: Generated depth-limited annotated tree of main folders.
10. **Development**: `npm run dev`, `npm run seed -- --size small`, `npm run verify`, and link to `CONTRIBUTING.md`.
11. **Status and roadmap**: Honest Beta note (`v0.7.0-beta`) + Known Limitations & v1 out-of-scope list from `docs-site/src/content/docs/project/roadmap.mdx`.
12. **Contributing, Security, License**: Links to `CONTRIBUTING.md`, `SECURITY.md`, and `LICENSE` (AGPL-3.0 hosted-fork obligation).

## Asset List (`docs/assets/readme/`)
- `logo-light.svg`, `logo-dark.svg` (Patchwork 2x2 grid mark + wordmark)
- `hero-board-light.png`, `hero-board-dark.png` (1600px, rounded-corner frame + soft shadow, < 300 KB)
- `ticket-panel-light.png`, `ticket-panel-dark.png`
- `command-palette-light.png`, `command-palette-dark.png`
- `search-light.png`, `search-dark.png`
- `system-config-light.png`, `system-config-dark.png`
- `setup-wizard-light.png`, `setup-wizard-dark.png`

## Sources of Claims
- Version, engines, scripts, dependencies: `package.json`, `scripts/lib/version.mjs`
- Features & RBAC: `src/lib/rbac.ts`, `src/lib/tickets.ts`, `src/lib/commands/registry.ts`, `src/lib/realtime.ts`, `src/lib/search.ts`, `src/lib/attachments.ts`, `src/lib/links.ts`, `src/lib/setup/`
- Installer & operations: `scripts/setup.mjs`, `src/app/api/health/route.ts`, `src/app/documentation/[[...path]]/route.ts`
- Known limitations / out of scope: `docs-site/src/content/docs/project/roadmap.mdx`
- Security & License: `SECURITY.md`, `LICENSE`
