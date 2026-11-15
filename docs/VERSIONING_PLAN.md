# Patchwork Versioning Plan (`v0.7.0-beta`)

## Step 0 Inspection Inventory

| Location | Current State | Planned Change |
|---|---|---|
| `package.json` | `"version": "1.0.0"` | Set `"version": "0.7.0-beta"` as single source of truth; add `version:check`, `release:prepare`, and include `version:check` in `verify`. |
| `package-lock.json` | `"version": "1.0.0"` | Sync via `npm install --package-lock-only` (in sync script). |
| `docs-site/package.json` | `"version": "1.0.0"` | Sync to `"0.7.0-beta"` via script. |
| `docs-site/package-lock.json` | `"version": "1.0.0"` | Sync via `npm --prefix docs-site install --package-lock-only` (in sync script). |
| `src/lib/version.ts` (new) | Missing | Export `version` (`0.7.0-beta`), `displayVersion` (`v0.7.0-beta`), `tag` (`v0.7.0-beta`), `channel` (`"beta"`), `buildDate` (from `NEXT_PUBLIC_APP_BUILD_DATE` injected in `next.config.ts`). Reads `package.json` via `next.config.ts` (`NEXT_PUBLIC_APP_VERSION`, `NEXT_PUBLIC_APP_BUILD_DATE`) on client and `package.json` fallback on server. |
| `scripts/lib/version.mjs` (new) | Missing | Read root `package.json` `version` at runtime; export `version`, `displayVersion`, `tag`, `channel`, `isValidSemver`, `syncPackageVersions`. |
| `next.config.ts` | No version env | Read `package.json` `version` once and expose `NEXT_PUBLIC_APP_VERSION` + `NEXT_PUBLIC_APP_BUILD_DATE` in `env`. |
| `src/app/api/health/route.ts` | `{ status, timestamp }` | Add `version`, `displayVersion`, `channel`. |
| `src/lib/diagnostics.ts` | Hardcoded fallback `"1.0.0"` | Use `version` / `channel` from `src/lib/version.ts`. |
| `src/components/SystemConfigView.tsx` | Hardcoded `Patchwork v1.0` | Render `Patchwork {displayVersion}`. |
| `src/components/system/HealthDiagnosticsSection.tsx` | `v{diagnostics.appVersion}` | Keep using `diagnostics.appVersion` (`v0.7.0-beta`). |
| `src/components/PatchworkApp.tsx` | Rail footer has no version | Add subtle `{displayVersion}` label in sidebar rail footer. |
| `src/components/UserSettingsModal.tsx` | No About section | Add compact **About** section showing `displayVersion`, `buildDate`, and links to `/documentation/project/changelog/` and `/documentation`. |
| `scripts/setup.mjs` | Banner & Step 8 have no version; `--check` doesn't compare installed vs disk version | Print `displayVersion` in banner, `--check`, and Step 8 summary. |
| `scripts/setup/state-detect.mjs` & `scripts/setup/repair.mjs` | Only checks `documentation-dist/.build-info.json` | Detect installed version (`.build-info.json` / `.patchwork-version.json` or DB/disk), report installed vs disk version in `--check` and Repair, and print `"Upgrade available: run migrations"` + link to `/documentation/operations/backups-and-upgrades/` if installed version is older. |
| `docs-site/astro.config.mjs` & `docs-site/src/components/Footer.astro` | Fallback `"1.0.0"`, footer `v{version}` | Read from `scripts/lib/version.mjs` (or root `package.json` without hardcoded `"1.0.0"`). |
| `docs-site/src/content/docs/index.mdx` | No version badge or beta notice | Add `v0.7.0-beta` badge and short "Beta software" note. |
| `docs-site/src/content/docs/getting-started/installation.mdx` | No version or beta notice | Add `v0.7.0-beta` reference and short "Beta software" note. |
| `docs-site/src/content/docs/project/roadmap.mdx` | No beta notice | Add "Beta software" note in Known Limitations. |
| `docs-site/src/content/docs/development/contributing-and-extending.mdx` | No `release:prepare` docs | Document `npm run release:prepare -- <version>` and `npm run version:check`. |
| `scripts/docs/copy-dist.mjs` | Fallback `"1.0.0"` | Use `scripts/lib/version.mjs` (`version`, `displayVersion`). |
| `scripts/docs/check.mjs` | Checks `base` in `.build-info.json` | Also run `checkVersionConsistency()` so `docs:check` enforces version consistency. |
| `README.md` | No version badge | Add `v0.7.0-beta` badge. |
| `CHANGELOG.md` & `docs-site/src/content/docs/project/changelog.mdx` | `## [Unreleased]` + `## [1.0.0] - 2026-11-15` | Move `Unreleased` items into `## [v0.7.0-beta] - 2026-11-15`, leave fresh empty `## [Unreleased]`, and add compare links at bottom using `v`-prefixed tags. |
| `CONTRIBUTING.md` | Mentions `docs:generate` and `CHANGELOG.md` | Document `npm run release:prepare -- <version>` and `npm run version:check`. |
| `AGENTS.md` | Standing rules 1–8 | Add rule 9: never hardcode a version; use the version helper; display `v` + SemVer; bump via `release:prepare`. |
| `scripts/check-version.mjs` (new) | Missing | Validate root `package.json` SemVer, check `docs-site/package.json`, lockfiles, `documentation-dist/.build-info.json`, `CHANGELOG.md`, and scan source/docs/tests for invalid display variants (e.g. `"0.7.0 beta"`, `"Beta 0.7.0"`). |
| `scripts/release-prepare.mjs` (new) | Missing | Update `package.json`, sync `docs-site` + lockfiles, roll `CHANGELOG.md` + `docs-site/.../changelog.mdx`, run checks (`version:check`, `docs:generate`, `docs:check`), and print `git commit` + `git tag v<version>` commands without running git. |
