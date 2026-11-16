# Patchwork Easy Install Plan (Step 0 Audit & Verification)

## 1. Step 0 Verification Results

### 1.1 MinIO Binary Availability & Checksum Verification (Live Check: 2026-11-15)

**`dl.min.io` status: RETIRED (`HTTP 410 Gone`)**

Live `HEAD`/`GET` checks against `https://dl.min.io/server/minio/release/...` for `windows-amd64`, `linux-amd64`, and `linux-arm64` all returned `410 Gone`:

> "The open-source MinIO Server, MinIO Client (mc) and MinIO KES projects are archived and no longer maintained... These files are no longer served from this site."

**Official GitHub Releases (`github.com/minio/minio/releases`)**:
- Latest release (`RELEASE.2025-10-15T17-29-55Z`) is source-only (no binary assets).
- Last official release with prebuilt binaries + `.sha256sum` files for all three target platforms is **`RELEASE.2025-09-07T16-13-09Z`**:
  - **Windows x64**: `https://github.com/minio/minio/releases/download/RELEASE.2025-09-07T16-13-09Z/minio.windows-amd64.RELEASE.2025-09-07T16-13-09Z.exe` (`113,115,136` bytes) + `.sha256sum`
  - **Linux x64**: `https://github.com/minio/minio/releases/download/RELEASE.2025-09-07T16-13-09Z/minio.linux-amd64.RELEASE.2025-09-07T16-13-09Z` (`110,989,496` bytes) + `.sha256sum`
  - **Linux arm64**: `https://github.com/minio/minio/releases/download/RELEASE.2025-09-07T16-13-09Z/minio.linux-arm64.RELEASE.2025-09-07T16-13-09Z` (`105,251,000` bytes) + `.sha256sum`

> **Decision needed**: `dl.min.io` (also currently referenced in `scripts/lib/platform.mjs`, `.github/workflows/ci.yml`, and docs) is `410 Gone`. Confirm whether Easy Mode (and `getMinioDownloadInfo()`) should pin `RELEASE.2025-09-07T16-13-09Z` from `github.com/minio/minio/releases` with its published `.sha256sum`, or use another source.

---

### 1.2 Embedded PostgreSQL Verification (`embedded-postgres`)

Tested in a clean temporary directory on **Windows x64** with **Node.js v26.5.0**:
- **Package**: `embedded-postgres@18.6.0-beta.19`
- **License**: `MIT` (compatible with `AGPL-3.0-only`)
- **Maintenance**: Active (`2026-10-30T17:55:51.683Z`, `pg@^8.23.1`, `exit-hook@^5.1.0`)
- **Supported platforms (via `optionalDependencies`)**: `@embedded-postgres/windows-x64`, `@embedded-postgres/linux-x64`, `@embedded-postgres/linux-arm64`, `@embedded-postgres/darwin-x64`, `@embedded-postgres/darwin-arm64` (plus `linux-arm`, `linux-ia32`, `linux-ppc64`)
- **Live test result**: `npm install`, `initialise()`, `start()`, `SELECT version()`, and `stop()` succeeded on Windows x64 + Node v26.5.0:
  - Reported: `PostgreSQL 18.6 on x86_64-windows, compiled by msvc-19.44.35228, 64-bit`
  - Observed notes:
    1. On Windows non-UTF8 system locales, `initdb` defaults to `WIN1252` unless UTF-8 flags (`--encoding=UTF8`, `--locale=C`) are configured.
    2. On Windows, `pg.stop()` can return slightly before the OS releases file handles in `pgdata`, so Reset/cleanup must retry briefly on `EBUSY`.
    3. `embedded-postgres@18.6.0-beta.19` is pinned to PostgreSQL 18.6 (optional `17.x` stable line also exists on npm).

---

## 2. Current Codebase Gaps (What Is Missing)

- **Installer modes (`scripts/setup.mjs`)**: Only supports system PostgreSQL (`localhost:5432`) and pre-installed MinIO (`./bin/minio` or `/usr/local/bin/minio`). No Easy vs Advanced selector, no `--easy` / `--advanced` flags, no "Only me vs Other people" MinIO exposure prompt, no root-user `patchwork` handling on Linux.
- **Database provisioning (`scripts/setup/db.mjs`)**: Connects to an existing Postgres server; does not initialize `./data/postgres`, pick a free high port, or manage an embedded Postgres process.
- **MinIO download & cache (`scripts/setup/minio.mjs`, `scripts/lib/platform.mjs`)**: Points to retired `dl.min.io` URLs and does not download, verify SHA-256 checksums, cache in `./data/cache`, handle proxies/offline mode, or spawn MinIO.
- **Process supervisor (`scripts/supervisor.mjs`)**: Missing. `npm run start` runs `next start` directly; `npm run stop` only stops the Next.js PID file; no `npm run status`, no crash-restart backoff for Postgres/MinIO, no unified shutdown.
- **Repair / Reset / Check**: Do not handle Easy-mode `./data/postgres`, `./data/minio`, `./data/cache`, stale PID/lock files, or backup via bundled `pg_dump`.
- **Docs & CI**: `README.md`, `docs-site/`, and `.github/workflows/ci.yml` reference `dl.min.io` and assume manual PostgreSQL + MinIO installation.

## 3. Risks & Mitigations

- **MinIO binary retirement**: Pinning `RELEASE.2025-09-07T16-13-09Z` from GitHub Releases restores verified SHA-256 downloads while awaiting user confirmation.
- **Windows antivirus / `EBUSY` locks**: Retry file locks briefly after stopping processes; surface actionable Antivirus/permission guidance if `./bin/minio.exe` is blocked.
- **Root execution on Linux**: PostgreSQL `initdb`/`postgres` refuses to run as `root`; detect `process.getuid() === 0` in platform helper and offer explicit `patchwork` user setup.
- **Major-version PG upgrades**: Pin `embedded-postgres` version in `package.json` and record PG major version in `./data/postgres/PG_VERSION` so upgrades never auto-run across major versions.

## 4. Clean-Environment Walkthrough Timing

- **Environment**: Windows 11 x64, Node.js `v26.5.0`
- **Command**: `node scripts/setup.mjs --easy --non-interactive --no-start` (with cached verified MinIO binary in `./data/cache/`)
- **Measured install duration (excluding `npm install`)**: `10.8s` (`10831 ms`), followed by `scripts/supervisor.mjs` -> `/api/health` 200 OK -> `scripts/status.mjs` (`easy`, PostgreSQL reachable, MinIO healthy) -> `scripts/stop.mjs` clean shutdown.
