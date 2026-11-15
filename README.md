# Patchwork

![Version](https://img.shields.io/badge/version-v0.7.0--beta-blue)

Patchwork is an open-source (`AGPL-3.0`), self-hosted engineering ticketing platform built for multi-team engineering organizations. Everything runs natively on the host operating system without Docker or container wrappers.

## Architecture & Stack

- **Web Application**: Next.js 15 (App Router, TypeScript), Tailwind CSS v4
- **Database**: Native PostgreSQL 16+ with Drizzle ORM (`drizzle-orm` + `drizzle-kit` plain SQL migrations)
- **Object Storage**: Official prebuilt MinIO binary (S3-compatible presigned URLs)
- **Authentication & RBAC**: Email/password hashed with `argon2id`, HTTP-only session cookies, CSRF header protection (`x-csrf-token`), server-enforced hierarchy roles (`admin` at Org level; `lead`, `member`, `viewer` at Team level)
- **Real-time Sync**: PostgreSQL `LISTEN/NOTIFY` bridged to Server-Sent Events (`/api/events`)
- **Full-Text Search**: PostgreSQL generated `tsvector` columns + `GIN` indexes across tickets, comments, and extracted attachment text (`.pdf`, `.txt`, `.md`, `.csv`, `.json`)

---

## Local Development Setup

### Prerequisites
1. **Node.js 20+**
2. **PostgreSQL 16+** running natively (`localhost:5432`)
3. **MinIO official binary** placed at `./bin/minio.exe` (Windows) or `./bin/minio` (Linux/macOS)

### Commands
```bash
# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Start local MinIO server & ensure buckets
npm run services:test

# Reset & migrate test database (patchwork_test)
npm run db:reset:test

# Run development server (http://localhost:3000)
npm run dev

# Full autonomous verification suite
npm run verify
```

---

## Cross-Platform Setup (Windows & Linux, No Docker)

Patchwork runs natively on **Windows 10/11** and **Linux (Ubuntu 22.04/24.04, Debian 12; x64 & arm64)** using Node.js, PostgreSQL, and MinIO. See [docs/CROSS_PLATFORM.md](docs/CROSS_PLATFORM.md) for contributor rules.

### Windows Setup (PowerShell / Windows Terminal)

1. **Install prerequisites**:
   - Node.js 20+: `winget install OpenJS.NodeJS.LTS`
   - PostgreSQL 16+: `winget install PostgreSQL.PostgreSQL` (remember the `postgres` password you choose; add `C:\Program Files\PostgreSQL\<ver>\bin` to `PATH` if `psql`/`pg_dump` are not found)
   - Official MinIO binary:
     ```powershell
     New-Item -ItemType Directory -Force -Path .\bin
     Invoke-WebRequest -Uri "https://dl.min.io/server/minio/release/windows-amd64/minio.exe" -OutFile .\bin\minio.exe
     ```
2. **Install dependencies & run installer**:
   ```powershell
   npm ci
   npm run setup
   ```
   The installer restricts `.env` with `icacls` to your Windows account, provisions PostgreSQL & MinIO, runs migrations, and builds the app.
3. **Run & Stop**:
   ```powershell
   npm run start
   npm run stop
   ```
4. **Windows Troubleshooting**:
   - If `psql` is not recognized, add `C:\Program Files\PostgreSQL\<version>\bin` to your user `PATH` or let `npm run setup` auto-detect it.
   - If `127.0.0.1` vs `::1` causes a local health probe timeout, ensure `APP_URL=http://localhost:3000` and `MINIO_PUBLIC_URL=http://localhost:9000`.

### Linux Deployment (Ubuntu 22.04/24.04 & Debian 12, x64 & arm64)

1. **Install prerequisites**:
   ```bash
   sudo apt update && sudo apt install -y curl postgresql postgresql-contrib
   # Install Node.js 20+ (e.g. via NodeSource or nvm)
   # Download MinIO for x64 (or linux-arm64/minio for arm64):
   mkdir -p ./bin && curl -fsSL "https://dl.min.io/server/minio/release/linux-amd64/minio" -o ./bin/minio && chmod +x ./bin/minio
   ```
2. **Run the unified Node.js installer**:
   ```bash
   npm ci
   npm run setup
   ```
   The installer enforces `chmod 600` on `.env`, supports peer authentication via `sudo -u postgres` (with confirmation), installs and enables hardened `deploy/patchwork.service` and `deploy/minio.service` units (`ProtectSystem=strict`, `NoNewPrivileges=true`), and optionally configures `ufw` (with confirmation).

### 2. Reverse Proxy Setup (SSE-Safe)

#### Option A: Caddy (`deploy/Caddyfile`)
Copy `deploy/Caddyfile` to `/etc/caddy/Caddyfile`, replace `patchwork.example.com` and `files.patchwork.example.com` with your app domain and dedicated MinIO file host (and add DNS records for both, plus set `MINIO_PUBLIC_URL=https://files.<domain>` in `.env`), then reload Caddy:
```bash
sudo cp /opt/patchwork/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```
The `/api/events*` route is configured with `flush_interval -1` so SSE events stream immediately without buffering.

#### Option B: Nginx (`deploy/nginx.conf`)
Copy `deploy/nginx.conf` to `/etc/nginx/sites-available/patchwork.conf`, replace `patchwork.example.com` and `files.patchwork.example.com` with your domains (with DNS records for both and `MINIO_PUBLIC_URL=https://files.<domain>` in `.env`), enable it, and reload Nginx:
```bash
sudo cp /opt/patchwork/deploy/nginx.conf /etc/nginx/sites-available/patchwork.conf
sudo ln -sf /etc/nginx/sites-available/patchwork.conf /etc/nginx/sites-enabled/patchwork.conf
sudo nginx -t && sudo systemctl reload nginx
```
The `/api/events` location disables `proxy_buffering` and `proxy_cache` and sets a 24-hour read timeout for persistent SSE connections.

---

## Upgrading Patchwork

```bash
cd /opt/patchwork
sudo -u patchwork git pull origin main
sudo -u patchwork npm ci
sudo -u patchwork npm run db:migrate
sudo systemctl restart patchwork.service
```
Note: Patchwork also auto-runs idempotent SQL migrations on server startup via `src/instrumentation.ts`.

---

## Backups & Restore

### 1. PostgreSQL Database Backup (`pg_dump`)
```bash
# Backup compressed custom-format dump
sudo -u postgres pg_dump -Fc patchwork > /var/backups/patchwork-$(date +%F).dump

# Restore into a fresh database
sudo -u postgres pg_restore -d patchwork --clean --if-exists /var/backups/patchwork-YYYY-MM-DD.dump
```

### 2. MinIO Attachment Data Directory Backup
MinIO stores all object data and metadata under `/var/lib/minio/data` (or `./.minio-data` in development):
```bash
# Sync MinIO data directory to backup storage
sudo rsync -a --delete /var/lib/minio/data/ /var/backups/minio-data/
```

---

## License

Licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See [LICENSE](./LICENSE).

