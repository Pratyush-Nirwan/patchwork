# Contributing to Patchwork

Thank you for contributing to Patchwork.

## Prerequisites

- **Node.js 20+** (22 recommended)
- **PostgreSQL 16+** running natively (`localhost:5432`)
- **Official MinIO binary** at `./bin/minio.exe` (Windows) or `./bin/minio` (Linux/macOS)
- No Docker: all services and scripts run natively on Windows 10/11 and Linux.

## Local Setup

```bash
npm install
npm --prefix docs-site install
cp .env.example .env
npm run db:reset:test
npm run seed -- --size small
npm run dev
```

## Verification Before Opening a Pull Request

Run the full check suite:

```bash
npm run docs:generate
npm run docs:check
npm run docs:build
npm run lint
npm run typecheck
npm run test
npm run build
```

## Documentation & Changelog Rules

- Every user-visible change must update the matching page in `docs-site/`, run `npm run docs:generate`, and add an entry under `## [Unreleased]` in `CHANGELOG.md`.
- Never hardcode version strings; read them from `src/lib/version.ts` or `scripts/lib/version.mjs` and display as `v` + SemVer (for example `v0.7.0-beta`).
- To prepare a release bump, run `npm run release:prepare -- <version>` (updates `package.json`, `docs-site/package.json`, lockfiles, `README.md` badge, and `CHANGELOG.md`, runs `version:check`/`docs:check`, and prints the git commands without running git). Verify anytime with `npm run version:check`.
- See `AGENTS.md` for standing cross-platform and documentation rules.
- By contributing, you agree that your contributions are licensed under **AGPL-3.0**.
