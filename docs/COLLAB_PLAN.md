# Collaboration & Notifications Implementation Plan

Status: **Step 0 — Plan & Prerequisite Check**  
Target Features (`website/src/data/roadmap.yaml`):
1. `ticket-watchers` — Ticket watchers
2. `in-app-notifications-mentions` — In-app notification center and @mentions
3. `outbound-email-webhooks` — Outbound email and webhook alerts
4. `presence-typing-indicators` — Presence and typing indicators

---

## 1. Prerequisite Check

| Prerequisite | Current State | Finding / Resolution | Blocker? |
| --- | --- | --- | --- |
| **User handles or IDs for mentions** | `users` table (`src/db/schema.ts`) has `id` (UUID), `email`, `name`, `isDeactivated`. No `username`/`handle` column. | Use stable ID-backed mention tokens `@[Display Name](mention:<uuid>)` in markdown. Server parses `<uuid>`, verifies user exists, is active, and can view the ticket, and ignores/strips unauthorized IDs. Display name resolves from accessible user map so renames never break mentions. | No |
| **Time zone source for digests** | No timezone field on `orgs`, `users`, or `systemSettings`. `AppearanceSettingsSchema` only has `dateTimeFormat`. | Add `defaultTimezone` (IANA timezone string, default `"UTC"`, validated via `Intl.DateTimeFormat`) to org Notifications settings in `src/lib/settings.ts` and System Configuration. | No |
| **Markdown renderer safety for mention tokens** | `src/components/MarkdownView.tsx` is a custom React JSX line/inline tokenizer (no `dangerouslySetInnerHTML`, no external HTML parser). | Safe. Fenced code blocks (` ``` `), inline code (`` `...` ``), and blockquotes (`> `) are already tokenized separately. Extend `renderInline` to render `@[Name](mention:<uuid>)` as a styled `<span>` chip; ignore/skip mention parsing inside code blocks, inline code, and blockquotes. | No |
| **Comment editing** | `src/lib/comments.ts` only has `addComment`; `comments/route.ts` only has `POST`. | Add `editComment()` + `PATCH /api/tickets/[ticketId]/comments/[commentId]` + inline edit UI for comment authors so comment-edit domain events and "notify only newly added mentions" work end-to-end. | No |
| **Saved filters** | Not implemented (`saved-views-filters` is `planned` in `roadmap.yaml`). | Implement only the `watching:me` search filter token in `src/lib/commands/parser.ts` and `src/lib/search.ts`. | No |

---

## 2. Current State Summary

- **Database & Migrations**: Drizzle ORM + `pg` (`src/db/index.ts`, `src/db/schema.ts`), SQL migrations in `drizzle/0000_*.sql` through `0010_ticket_archived_at.sql`, auto-applied in `src/instrumentation.ts` (`ensureMigrated()` with `pg_advisory_lock(84729104)`).
- **Ticket & Comment Mutations**: All mutations go through service functions in `src/lib/tickets.ts` (`createTicket`, `updateTicket`, `moveTicket`, `archiveTicket`, `deleteTicket`), `src/lib/comments.ts` (`addComment`), `src/lib/attachments.ts` (`uploadTicketAttachment`, `deleteAttachment`), and `src/lib/links.ts` (`addTicketLink`, `removeTicketLink`). API routes call these services; `/api/commands/execute/route.ts` also calls them.
- **Realtime**: `src/lib/realtime.ts` (`RealtimeHub`) uses `pg.Client` `LISTEN patchwork_events` and `pool.query("SELECT pg_notify('patchwork_events', $1)")`. `/api/events/route.ts` streams board-scoped SSE with 15s heartbeat and session validation.
- **Permissions**: `src/lib/rbac.ts` (`getAccessibleTeamIds`, `requireTicketRole`, `requireBoardRole`, `PERMISSIONS_MATRIX`). Roles: `admin`, `lead`, `member` (`developer`/`tester`), `viewer`.
- **Settings & Encryption**: `src/lib/settings.ts` (`systemSettings` table, Zod schemas, in-memory cache, `getSystemSetting`, `setSystemSetting`, `resetSystemSetting`). `src/lib/setup-token.ts` provides AES-256-GCM (`encryptSetupToken`, `decryptSetupToken`, `keyVersion`) using `TOKEN_ENCRYPTION_KEY`.
- **Supervisor & Installer**: `scripts/supervisor.mjs` manages PostgreSQL, MinIO, and Next.js. `scripts/setup.mjs` + `scripts/setup/repair.mjs` handle Easy/Advanced install, `--check`, and repair. No new OS process is required when worker runs embedded in `instrumentation.ts`.

---

## 3. Architecture & Data Model

### 3.1 New Tables (Drizzle migration `drizzle/0011_collab_notifications.sql`)

1. **`domain_events`** (Transactional outbox)
   - `id` (uuid PK), `event_type` (text), `aggregate_type` (`"ticket"`), `aggregate_id` (uuid), `org_id` (uuid), `team_id` (uuid), `board_id` (uuid), `actor_id` (uuid nullable), `idempotency_key` (text unique), `metadata` (jsonb — IDs, changed field names, column names, priority/label keys; **never** full descriptions or comment bodies), `created_at`, `processed_at` (nullable), `attempts` (int default 0), `next_attempt_at` (timestamp), `last_error` (text nullable), `dead_lettered_at` (timestamp nullable).
   - Indexes: `(processed_at, next_attempt_at)` partial/composite for `FOR UPDATE SKIP LOCKED`, `(aggregate_id, created_at)`.

2. **`ticket_watchers`**
   - `id` (uuid PK), `ticket_id` (uuid FK `tickets.id` cascade), `user_id` (uuid FK `users.id` cascade), `source` (`"manual" | "creator" | "assignee" | "commenter" | "mentioned"`), `muted` (boolean default false), `unwatched_at` (timestamp nullable — respects explicit unwatch against same-reason auto-watch), `created_at`.
   - Unique index: `(ticket_id, user_id)`. Index: `(user_id, muted)`.

3. **`user_notification_preferences`**
   - `user_id` (uuid PK FK `users.id` cascade), `in_app_mentions` (bool true), `in_app_assignments` (bool true), `in_app_watched` (bool true), `email_mentions` (`"off" | "immediate" | "digest"` default `"immediate"`), `email_assignments` (`"off" | "immediate" | "digest"` default `"immediate"`), `email_watched` (`"off" | "digest"` default `"off"`), `digest_frequency` (`"daily" | "weekly"` default `"daily"`), `digest_hour` (int 0-23 default 9), `digest_day` (int 0-6 default 1), `auto_watch_creator` (bool true), `auto_watch_assignee` (bool true), `auto_watch_commenter` (bool true), `auto_watch_mentioned` (bool true), `presence_enabled` (bool true), `updated_at`.

4. **`notifications`**
   - `id` (uuid PK), `recipient_id` (uuid FK `users.id` cascade), `type` (`"mention" | "assignment" | "unassignment" | "watched_update"`), `ticket_id` (uuid FK `tickets.id` cascade), `comment_id` (uuid nullable FK `ticket_comments.id` onDelete set null), `actor_id` (uuid nullable FK `users.id` onDelete set null), `summary` (jsonb — minimal: `ticketKey`, `count`, `eventKind`, `snippet` <= 140 chars only for mention/comment), `dedupe_key` (text unique), `group_key` (text), `created_at`, `updated_at`, `read_at` (nullable), `archived_at` (nullable).
   - Indexes: `(recipient_id, archived_at, read_at, created_at DESC)` for fast <100ms list & unread count at 100k+ rows; `(recipient_id, group_key, created_at DESC)` for 5-minute coalescing.

5. **`email_outbox`**
   - `id` (uuid PK), `recipient_id` (uuid FK `users.id` cascade), `category` (`"mention" | "assignment" | "digest"`), `ticket_id` (uuid nullable), `notification_ids` (jsonb), `subject` (text), `idempotency_key` (text unique), `status` (`"pending" | "sent" | "dead_letter"`), `attempts` (int), `next_attempt_at`, `sent_at` (nullable), `last_error` (text nullable — redacted), `created_at`.

6. **`webhook_endpoints`**
   - `id` (uuid PK), `org_id` (uuid FK `orgs.id` cascade), `name` (text), `url` (text), `format` (`"generic" | "slack" | "discord" | "mattermost"`), `events` (text[]), `scope_team_ids` (uuid[]), `scope_project_ids` (uuid[]), `scope_board_ids` (uuid[]), `secret_ciphertext` (text), `secret_iv` (text), `secret_auth_tag` (text), `secret_key_version` (int default 1), `enabled` (boolean default true), `consecutive_failures` (int default 0), `disabled_reason` (text nullable), `disabled_at` (timestamp nullable), `created_by_id` (uuid nullable), `created_at`, `updated_at`.

7. **`webhook_deliveries`**
   - `id` (uuid PK), `endpoint_id` (uuid FK `webhook_endpoints.id` cascade), `domain_event_id` (uuid nullable), `event_type` (text), `idempotency_key` (text unique), `payload` (jsonb — sanitized, no secrets/emails), `status` (`"pending" | "delivered" | "failed" | "dead_letter"`), `attempts` (int), `next_attempt_at`, `response_status` (int nullable), `duration_ms` (int nullable), `last_error` (text nullable — redacted), `delivered_at` (nullable), `created_at`.

8. **`worker_health`** (Single-row/per-worker heartbeat table for System Configuration -> Health & `--check`/Repair)
   - `id` (text PK `"default"`), `worker_id` (text), `mode` (`"embedded" | "separate"`), `last_heartbeat_at`, `started_at`, `processed_events` (bigint), `last_error` (text nullable), `updated_at`.

### 3.2 Shared Domain Event Emitter & Worker

- **`src/lib/domain-events.ts`**: `emitDomainEvent(txOrDb, input)` called inside the **same `db.transaction()`** as every ticket/comment/watcher mutation (`createTicket`, `updateTicket`, `moveTicket`, `archiveTicket`, `deleteTicket`, `addComment`, `editComment`, `addWatcher`, `uploadTicketAttachment`, `deleteAttachment`, `addTicketLink`, `removeTicketLink`).
- **Static & Runtime Enforcement**: Test in `tests/domain-events.test.ts` statically scans mutating service functions/routes to ensure `emitDomainEvent` is invoked inside transactions.
- **Worker (`src/lib/worker.ts` + `scripts/worker.mjs`)**:
  - Started from `src/instrumentation.ts` unless `WORKER_MODE=separate` (or `NODE_ENV === "test"` unless explicitly started in tests).
  - Uses PostgreSQL session advisory lock (`pg_try_advisory_lock(92837465)`) on a dedicated `pg.Client` so only **one** instance processes across `next dev` HMR, `next start`, standalone, or multi-instance.
  - Polls/wakes via `LISTEN patchwork_domain_events` + 2s fallback tick.
  - Processes: `domain_events` -> watchers/notifications/email_outbox/webhook_deliveries; `email_outbox` (`FOR UPDATE SKIP LOCKED`, exponential backoff + jitter, max 6 attempts, dead-letter, per-recipient rate limit); `webhook_deliveries` (`FOR UPDATE SKIP LOCKED`, 6 attempts over ~1h, circuit breaker auto-disable); digest scheduler (minute-bucket check in `defaultTimezone` handling DST via `Intl.DateTimeFormat`); retention cleanup (read notifications > `retentionDays`, delivery logs > `deliveryLogRetentionDays`, processed `domain_events`); presence expiry sweep; `worker_health` heartbeat.
  - Graceful shutdown on `SIGTERM`/`SIGINT` waits for in-flight batch and releases advisory lock.

### 3.3 Real-Time Transport (SSE + LISTEN/NOTIFY)

- **User Notifications SSE** (`/api/notifications/stream`): Authenticated per-user SSE stream subscribing to `patchwork_user_notifications` channel (minimal payload `{ recipientId, notificationId }`). Client fetches full authorized notification via `GET /api/notifications`, updates unread badge, and syncs across tabs via `BroadcastChannel("patchwork_notifications")`. Silent reconnect + catch-up (`?since=` / unread count).
- **Ticket Presence & Typing** (`src/lib/presence.ts`): Ephemeral in-memory `Map<ticketId, Map<userId, PresenceEntry>>` + `pg_notify('patchwork_presence', ...)` for cross-instance fan-out. `POST /api/tickets/[ticketId]/presence` (heartbeat/typing/leave via `sendBeacon`), `GET /api/tickets/[ticketId]/presence/stream` (or multiplexed on `/api/events`? Dedicated ticket-room SSE `/api/tickets/[ticketId]/presence` or `/api/events?ticketId=` — using `/api/tickets/[ticketId]/presence/stream` keeps board SSE clean and enforces ticket-level RBAC on subscribe and every event!).

### 3.4 Settings & Permissions

- **Org Settings (`src/lib/settings.ts`)**:
  - `notifications`: `{ defaultTimezone, retentionReadDays (90), retentionUnreadCap (500), deliveryLogRetentionDays (30), presenceEnabled (true), includeTicketTextInEmails (false), allowPrivateNetworkWebhooks (false), smtp: { enabled, host, port, security ("none"|"starttls"|"tls"), username, passwordCiphertext/Iv/AuthTag/KeyVersion, fromName, fromAddress, replyTo } }`.
- **RBAC**:
  - `system.configure` (admin only): SMTP settings, test email, webhook CRUD/rotation/retry/logs, `allowPrivateNetworkWebhooks`, `presenceEnabled`, retention.
  - `ticket.watch` (`admin`, `lead`, `member`, `viewer` — anyone with `workspace.view` on the ticket).
  - Notifications & personal preferences: authenticated user's own data only.
- **Slash Commands (`src/lib/commands/registry.ts`)**:
  - `/watch [ticket]` (minRole: `viewer`)
  - `/unwatch [ticket]` (minRole: `viewer`)
  - `/mute [ticket]` (minRole: `viewer`)
  - `/notifications` (minRole: `viewer`, client navigation)
  - `/read-all` (minRole: `viewer`, server execution)

---

## 4. Build Order

1. **Foundations**: Migration `0011`, `domain_events` + `emitDomainEvent`, wrap all ticket/comment/attachment/link mutations in transactions, worker with advisory lock + `WORKER_MODE=separate` (`npm run worker`) + health reporting in `diagnostics.ts` / System Config Health / `repair.mjs` / `--check`.
2. **Ticket Watchers**: `ticket_watchers` service + auto-watch + mute + API (`/api/tickets/[ticketId]/watch`) + UI toggle/popover/card badge + `watching:me` search token + `/watch`, `/unwatch`, `/mute` commands.
3. **Mentions & Notification Core**: Mention token parser/validator + `MarkdownView` chip + `notifications` table + worker fan-out + 5-min coalescing + retention + read-time redaction + APIs (`/api/notifications`, `/api/notifications/[id]`, `/api/notifications/read-all`).
4. **Notification Center UI & Real-Time**: Header bell + popover/mobile sheet + `/notifications` page (tabs, `j`/`k`/Enter, infinite scroll, skeletons, error boundary) + `/api/notifications/stream` SSE + `BroadcastChannel` + `/notifications` & `/read-all` commands + Account Settings → Notifications.
5. **Email (SMTP)**: Install `nodemailer` + `@types/nodemailer`, System Config → Notifications → Email UI + test email, immediate & digest scheduler (org timezone + DST), signed single-purpose unsubscribe tokens, outbox retries/rate-limit, masked delivery log.
6. **Webhooks**: System Config → Notifications → Webhooks UI, encrypted secret + one-time reveal + rotation, HMAC-SHA256 signing, SSRF protection (DNS pin, IPv4/IPv6 private/loopback/link-local/metadata block, no redirects, `allowPrivateNetworkWebhooks` toggle), Slack/Discord/Mattermost/Generic formats, circuit breaker, delivery log & manual retry.
7. **Presence & Typing**: Ephemeral presence store + `patchwork_presence` NOTIFY, heartbeats (15s view, 3s typing, 5s/35s expiry, `sendBeacon`, Page Visibility pause), avatar stack + typing indicator UI, org & user privacy toggles, 50-viewer load test.
8. **Docs, Website, Seed, Roadmap & Final Loop**: `seed.mjs`, User/Admin/Operations/Security/Privacy docs, `features.yaml`, `roadmap.yaml`, `changelog-scopes.yaml`, `CHANGELOG.md`, `website/src/pages/` & screenshots, `docs:export`, `docs:generate`, `readme:generate`, full test-fix loop.

---

## 5. Dependencies & Risks

- **New Dependencies**:
  - `nodemailer` (MIT license, actively maintained, ~100KB unpacked, zero runtime dependencies) — standard Node.js SMTP client for STARTTLS/TLS/local relay.
  - `@types/nodemailer` (MIT license, devDependency).
  - *No queue library* (PostgreSQL `FOR UPDATE SKIP LOCKED` used instead).
- **Key Risks & Mitigations**:
  - *Double worker execution in `next dev`*: Mitigated by PostgreSQL session advisory lock + `globalThis` singleton guard.
  - *SSRF via DNS rebinding or IP encodings*: Mitigated by resolving DNS before connect, validating all returned A/AAAA records against private/reserved CIDR ranges, and connecting directly to the pinned IP with `Host` header / TLS `servername` + `redirect: "manual"` (never follow redirects).
  - *Cross-user data leakage*: Read-time permission checks on every notification fetch, digest build, SSE push, watcher list, and presence subscription; redaction fallback `"You no longer have access to this ticket"`.

---

## 6. Open Decisions (For User Confirmation)

1. **`shippedIn` version in `roadmap.yaml`**: Should the 4 items be marked `shipped` under `v0.8.0-beta` or `v1.0.0` once complete, or left `in-progress` until you specify?
2. **Defaults**: Confirm defaults are acceptable: `WORKER_MODE=embedded` (leader-elected), read notification retention = `90` days, unread cap = `500`, org default timezone = `UTC`, SMTP disabled by default, `allowPrivateNetworkWebhooks = false`.
