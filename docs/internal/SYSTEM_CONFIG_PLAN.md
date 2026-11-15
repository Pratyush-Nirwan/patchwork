# System Configuration Implementation Plan

## Overview
This document specifies the technical design, codebase audit findings, database mapping, and implementation plan for:
1. **Change 1: Public Registration Removal**
2. **Change 2: System Configuration Tab (Admin Only)**

---

## 1. Codebase Audit & Architectural Mapping

### Change 1: Remove Public Registration
- **UI Changes**:
  - `src/components/PatchworkApp.tsx`:
    - Remove `authMode` toggles (`"login" | "register"`), tabs, registration form fields (e.g. name), and "Register & Continue" buttons.
    - Update login modal copy: *"Contact your administrator for an account."*
    - Ensure zero links/buttons for public registration exist anywhere in workspace UI.
- **Server Changes**:
  - `src/app/api/auth/register/route.ts`:
    - Check workspace setup completion status (`setupState.isCompleted`).
    - Once setup is completed, immediately reject with `HTTP 403 Forbidden` (`{ error: "registration_closed", message: "Public registration is disabled. Contact your administrator." }`).
    - During setup, user account creation is restricted strictly to the setup token flow (Step 1 Admin Registration).
  - Page Route `/register`:
    - Ensure any navigation or GET request to `/register` returns `404 Not Found` (via `notFound()` in `src/app/register/page.tsx`).

---

### Change 2: System Configuration Sections

| Section | Codebase Support | Database & Schema Mapping | Additional Options & Hardcoded Values Found |
| :--- | :--- | :--- | :--- |
| **Section A: Users** | Supported | `users`, `org_members`, `team_members`, `sessions`, `setup_credentials`. Add `is_deactivated` (boolean, default false) and `last_login_at` (timestamp with timezone) to `users` via migration. | - System password pattern (`FirstnameL@1234`) and 16-char crypto password generator in `src/lib/setup.ts`.<br>- Force sign-out deletes sessions for targeted user(s).<br>- Deletion safeguard: reassign tickets to another user or unassign; preserve comments/activities by attributing to placeholder `"Deleted User"`.<br>- Server-side guards: prevent self-deactivation/deletion/demotion and last-admin deactivation/deletion/demotion. |
| **Section B: Organization** | Supported | `orgs` table (`name`, `slug`, `description`). | - Slug rename warning regarding URL changes.<br>- Validation: slugify helper in `src/lib/slug.ts`. |
| **Section C: Teams, Projects, Boards** | Supported | `teams`, `projects`, `boards`, `columns`, `team_members`. | - Dependent items counts (projects, boards, tickets, members).<br>- Project transfer between teams updates project `teamId` and related references.<br>- Team default columns stored in `system_settings` (`team_default_columns`), editable with drag reorder, rename, WIP limit. |
| **Section D: Roles & Permissions** | Supported | Read-only matrix mapped directly from `src/lib/rbac.ts` (`ROLE_WEIGHT` and effective permissions for `admin`, `lead`, `member`, `viewer`). | - Export shared single source of truth permission definitions from `src/lib/rbac.ts` so runtime enforcement and UI matrix never diverge. |
| **Section E: Security** | Supported | Stored in `system_settings` (`security_policy`). | - **Hardcoded defaults replaced**:<br>  * Password min length: default 8 (found in `src/lib/auth.ts`).<br>  * Password complexity: mixed case, digit, symbol requirements.<br>  * Session duration: default 7 days (`1000 * 60 * 60 * 24 * 7` in `src/lib/auth.ts`).<br>  * Idle session timeout: default 0 (disabled).<br>  * Rate limit failures: default 5 (`RATE_LIMIT_MAX_FAILURES` in `src/lib/setup-token.ts`).<br>  * Rate limit lockout window: default 15 min (`RATE_LIMIT_WINDOW_MS` in `src/lib/setup-token.ts`).<br>- "Sign out all users" revokes all active sessions (`DELETE FROM sessions`). |
| **Section F: Attachments & Storage** | Supported | Stored in `system_settings` (`storage_policy`), MinIO client in `src/lib/attachments.ts`, `ticket_attachments` table. | - **Hardcoded defaults replaced**:<br>  * Max upload size: default 5MB (`process.env.MAX_ATTACHMENT_BYTES || 5 * 1024 * 1024`).<br>  * Allowed file types: default `txt, md, pdf, csv, json, png, jpg, jpeg, webp, gif` (found hardcoded in `ALLOWED_EXTENSIONS` and `ALLOWED_MIME_TYPES`).<br>  * Presigned URL expiry: 900s.<br>- MinIO health check: read-only bucket status and ping.<br>- Storage used: `SUM(size_bytes)` from `ticket_attachments`.<br>- Orphaned objects: scans MinIO objects and compares against `storage_key` in `ticket_attachments`; previews and purges orphans. |
| **Section G: Search** | Supported | PostgreSQL tsvector & GIN indexes (`tickets_search_idx`, `ticket_comments_search_idx`, `ticket_attachments_search_idx`) in `src/lib/search.ts` and `src/db/schema.ts`. | - Indexed counts: count of tickets, comments, attachments with generated vectors.<br>- Mutual exclusion lock: in-memory / advisory lock ensuring only one index rebuild runs at a time. |
| **Section H: Integrations (GitHub/GitLab)** | Supported | Stored in `system_settings` (`integrations_config`). Tokens encrypted with AES-256-GCM using `process.env.TOKEN_ENCRYPTION_KEY`. | - Allowed hosts: default `["github.com", "gitlab.com"]`, customizable for self-hosted instances.<br>- Cache TTL: default 300 seconds.<br>- Test connection action: executes test request to GitHub/GitLab API without exposing token. |
| **Section I: Appearance & Defaults** | Supported | Stored in `system_settings` (`appearance_defaults`). | - Default theme: `light`, `dark`, `system` (default `system`).<br>- Default priorities & hex colors: `urgent` (#EF4444), `high` (#F97316), `medium` (#EAB308), `low` (#3B82F6), `none` (#64748B).<br>- Labels: list, add, rename, recolor, delete (with in-use check on `tickets.labels`).<br>- Default board columns: Backlog, In Progress, Review, Done.<br>- Date/Time format: ISO, localized, etc. |
| **Section J: System Health & Diagnostics** | Supported | Read-only telemetry: `process.version`, `package.json` version, PostgreSQL ping latency, MinIO health, applied migrations vs `_journal.json`, SSE listeners count (`realtimeHub.getListenerCount()`), `process.uptime()`. | - Recent server errors: in-memory circular buffer (last 50 errors) with strict secret scrubbing (redacting passwords, tokens, auth cookies, connection strings).<br>- "Download diagnostics" button: outputs sanitized JSON diagnostic bundle. |
| **Section K: Data & Backup** | Supported | JSON & CSV export endpoints across users, teams, projects, boards, tickets, comments, labels. | - Users exported without passwords.<br>- Manual backup instructions: display read-only command template (`pg_dump`) and MinIO data path (read-only text; not executed by app). |
| **Section L: Danger Zone** | Supported | Administrative bulk maintenance operations with strict typed confirmation and affected count preview. | - Action 1: "Archive all tickets older than N days" (or move to completed/archived state with preview).<br>- Action 2: "Delete all deactivated users" (with email/name list preview and permanent purge).<br>- Setup wizard reset is explicitly prohibited. |

---

## 2. Out-of-Scope Features (Explicitly Skipped)
Per v1 constraints, the following are not built and marked as out of scope:
- Email notifications / SMTP delivery
- In-app notification centers / @mentions
- Audit log streams / tables
- REST API personal access tokens
- Outgoing webhooks
- SSO / OAuth2 identity providers

---

## 3. Database Schema Updates (`drizzle/0005_system_settings.sql`)
1. Create `system_settings` table:
   - `key`: `text primary key`
   - `value`: `jsonb not null`
   - `updated_by_id`: `uuid references users(id) on delete set null`
   - `updated_at`: `timestamp with time zone not null default now()`
2. Add columns to `users` table:
   - `is_deactivated`: `boolean not null default false`
   - `last_login_at`: `timestamp with time zone`

---

## 4. Architectural Patterns & Security
- **Zod Schemas**: Every setting key is strictly validated on load and save using typed Zod schemas in `src/lib/settings.ts`.
- **In-Memory Cache**: Cached settings with immediate cache invalidation upon mutation.
- **Server-Side Authorization**: Every route under `/dashboard/system/*` and every API route under `/api/system/*` invokes `requireOrgAdmin(session.user.id, orgId)` server-side.
- **Secret Redaction**: Environment credentials (`DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `S3_SECRET_KEY`) are never exposed or editable via the UI or API.

