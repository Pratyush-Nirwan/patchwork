# @patchwork/website

Self-contained Astro + Starlight marketing site and documentation package for **Patchwork**.

## Quick Start (Standalone)

```bash
npm ci
npm run generate
npm run check
npm run build:website
npm run preview
```

## Build Targets

- **`BUILD_TARGET=website`** (`npm run build:website`): Public marketing site (`/`, `/features/`, `/get-started/`, `/security/`, `/license/`) plus documentation at `/documentation/...`.
- **`BUILD_TARGET=embedded`** (`npm run build:embedded`): Documentation only for the Patchwork app's `/documentation` route (`noindex`, no marketing pages, assets under `documentation/_astro/`).

## Environment Variables

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `BUILD_TARGET` | `website` | `website` or `embedded` |
| `SITE_URL` | *(unset)* | Canonical public origin (e.g. `https://patchwork.example.com`) |
| `SITE_BASE` | `/` | Base path for project-path hosting (e.g. `/patchwork`) |
| `REPO_URL` | from `app-meta.json` | GitHub repository URL |
| `WEBSITE_URL` | `/` | Header link back to marketing site from docs |

## Data Flow & Splitting to a Separate Repository

`website/` never imports or reads files outside `website/`. The app repository exports deterministic snapshots into `src/data/generated/` via `npm run docs:export` at the root. To move `website/` to its own repository, copy this folder with `src/data/generated/` intact and replace the root export step with a CI job in the app repo that opens a PR updating `src/data/generated/`.
