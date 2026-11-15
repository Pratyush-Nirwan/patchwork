# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Next.js (App Router, TypeScript), PostgreSQL (native), Drizzle ORM + drizzle-kit (plain SQL migrations), Tailwind CSS + shadcn/ui, MinIO (official prebuilt binary, S3-compatible).

## Users
Developers, team leads, and engineering admins in larger engineering organizations with multiple teams managing backlogs, active boards, code links, and technical discussions.

## Product Purpose
Patchwork is an open-source (AGPL-3.0), self-hosted ticketing platform for multi-team engineering organizations. It enables fast, keyboard-first issue tracking across Organization -> Teams -> Projects -> Boards -> Tickets without container or cloud lock-in.

## Positioning
Zero-Docker, native-first self-hosted engineering tracker with PostgreSQL LISTEN/NOTIFY real-time Kanban boards, full-text search across tickets, comments, and extracted attachment text (PDF, TXT, MD), and live GitHub/GitLab PR/commit/issue status inspection.

## Operating Context
Used daily in desktop and laptop browsers alongside IDEs, terminals, and Git forges. High information density, keyboard navigation, and instant state synchronization across team members via Server-Sent Events (SSE).

## Capabilities and Constraints
- Hierarchy: Org -> Teams -> Projects -> Boards -> Tickets
- Auth & RBAC: Email/password (Argon2id hashed, HTTP-only session cookies, CSRF validation). Org-level `admin`; team-level `lead`, `member`, `viewer` enforced server-side on every route/action.
- Kanban Boards: Custom columns per board (create, rename, reorder, delete, optional WIP limit), drag-and-drop movement and reordering, real-time sync via PostgreSQL `LISTEN/NOTIFY` -> SSE.
- Tickets: Title, markdown description, assignee, priority (`urgent`, `high`, `medium`, `low`, `none`), labels, markdown comments, per-ticket activity history, MinIO presigned attachments (size/type enforced, text extracted), and GitHub/GitLab link previews.
- Search: PostgreSQL `tsvector` + GIN indexes over tickets, comments, and attachment text, with ranked highlighted snippets scoped by user permissions.
- Native-only deployment: systemd units (`patchwork.service`, `minio.service`), Caddy/Nginx SSE-safe configs, `scripts/install.sh`.

## Product Principles
1. **Density over decoration**: High-signal, compact engineering layouts where key identifiers, priorities, assignees, and WIP limits read at a glance.
2. **Real-time by default**: Board mutations propagate immediately over PostgreSQL `LISTEN/NOTIFY` and SSE without manual refresh.
3. **Strict boundary enforcement**: Every read and mutation verifies org and team RBAC roles, CSRF tokens, and attachment constraints server-side.
4. **Native operational simplicity**: Runs directly on host PostgreSQL, Node.js, and MinIO binaries without container layers.

