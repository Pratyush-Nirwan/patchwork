# Patchwork Agent & Contributor Standing Rules

1. **No Docker**: Everything runs natively on Windows 10/11 and Linux (Ubuntu 22.04/24.04, Debian 12; x64 & arm64).
2. **All scripts are Node.js**: Write all tooling in `.mjs` or `.ts`. Do not add `.sh`, `.bat`, or `.ps1` scripts. Keep `package.json` scripts shell-agnostic (`cross-env`, `scripts/run-chain.mjs`).
3. **Single platform helper**: Only `scripts/lib/platform.mjs` and `src/lib/platform.ts` may read `process.platform` or `process.arch`.
4. **Path & process safety**: Always use Node `path` APIs, `os.tmpdir()`, `shell: false` on `spawn`/`execFileSync`, and `sanitizeFilename()` for user-facing or exported filenames.
5. **LF line endings**: Keep LF (`\n`) across code, generated configs, and SQL per `.gitattributes` and `.editorconfig`.
6. **Testing & CI**: Run tests against `patchwork_test` and a temporary MinIO data directory. Any feature touching filesystems, processes, or services must include cross-platform tests and pass CI on both Windows and Linux.
7. **Documentation**: Documentation is part of the definition of done. Any change that adds, changes, or removes user-visible behavior, a command, a setting, an environment variable, a permission, a script, an installer step, a migration, a keyboard shortcut, or a deployment step must update the matching page in `docs-site/` in the same change, run `npm run docs:generate`, and add a Changelog entry. Never leave docs describing behavior that no longer exists. Never document behavior that is not implemented.
8. **UI Motion & Skeletons**: Animate only `transform` and `opacity` using the shared motion tokens and primitives (`src/lib/motion.ts`, `src/components/ui/motion.tsx`, `src/components/ui/skeleton.tsx`). Respect `prefers-reduced-motion` and the in-app `patchwork_reduce_motion` setting everywhere, wrap storage access in `try/catch`, and use anti-flash (`150ms` delay / `300ms` hold) and stale-while-revalidate patterns for loading states.
9. **Versioning**: Never hardcode a version anywhere; always read it from the version helper (`src/lib/version.ts` for the app, `scripts/lib/version.mjs` for scripts). Always display the version as `v` plus SemVer (for example `v0.7.0-beta`, never without `v` or with a space). Any release bump must use `npm run release:prepare -- <version>` and pass `npm run version:check`.


