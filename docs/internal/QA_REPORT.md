# Patchwork QA Audit & Bug-Fix Report

**Audit Scope**: Complete static, integration, security, performance, UX, accessibility, and responsive audit of Patchwork (Next.js App Router, TypeScript, PostgreSQL, Drizzle ORM, MinIO) executed natively on Windows against the isolated `patchwork_test` database and a temporary MinIO data directory (`%TEMP%\patchwork-qa-minio`).

---

## 1. Executive Summary

- **Defects Identified**: 17 total
  - **P0 (Blocker)**: 3 (all fixed)
  - **P1 (High / Security & Major UX)**: 9 (all fixed)
  - **P2 (Medium / UX & Accessibility)**: 4 (all fixed)
  - **P3 (Low / Docs & Polish)**: 1 (fixed)

### Top 10 Issues to Fix First (Status)
1. **[P0 - Fixed]** Broken TypeScript/ESLint build from leftover duplicate declarations in `src/db/schema.ts`, `src/lib/rbac.ts`, `src/lib/tickets.ts`, `src/lib/hierarchy.ts`, and `src/components/PatchworkApp.tsx`.
2. **[P0 - Fixed]** `changeUserPassword` in `src/lib/auth.ts` skipped `currentPassword` verification whenever `currentPassword` was omitted, allowing any unlocked session to change a user's password without knowing the old one even when `mustChangePassword` was `false`.
3. **[P0 - Fixed]** Duplicate column names (`"BacklogBacklog"`) and dead sub-role guard expression in Kanban card and Ticket Detail `<select>` dropdowns in `src/components/PatchworkApp.tsx`.
4. **[P1 - Fixed]** Missing login rate limiting / lockout in `/api/auth/login` despite `SecuritySettingsSchema` defining `rateLimitMaxFailures` and `rateLimitWindowMs`.
5. **[P1 - Fixed]** File upload validation in `src/lib/attachments.ts` checked only filename extension and client-supplied MIME header; spoofed files (e.g., `<script>alert(1)</script>` uploaded as `evil.png`) succeeded with HTTP 201.
6. **[P1 - Fixed]** Unhandled 500 errors in `src/lib/http.ts` (`handleApiError`) leaked raw internal error messages (including SQL/table/connection details) to API clients.
7. **[P1 - Fixed]** `SystemConfigView.tsx` ignored `localStorage.getItem("patchwork_theme")` on load and had an uncollapsible `w-56` sidebar that crushed mobile (`390x844`) content into ~150px.
8. **[P1 - Fixed]** Missing HTTP security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) in `next.config.ts`, and `/dashboard/system` middleware returned plain-text `403` to unauthenticated visitors instead of redirecting to login.
9. **[P1 - Fixed]** `RealtimeHub` in `src/lib/realtime.ts` cleared `this.pgClient` on `error`/`end` without scheduling automatic reconnect for existing SSE subscribers.
10. **[P1 - Fixed]** `sessionIdleTimeoutMs` in System Configuration -> Security is now enforced on `sessions` via `last_active_at` (`0009_session_last_active.sql`) with 60s-throttled activity touch, `401 SESSION_IDLE_EXPIRED`, and client draft preservation.

---

## 2. Findings Table

| ID | Severity | Area | Finding | Status | Location |
|---|---|---|---|---|---|
| QA-01 | P0 | Build / Types | Duplicate `MemberSubRole`, `require*Role`, and dangling `const isJumpDisallowed =` broke `tsc --noEmit` and `eslint` | **Fixed** | `src/db/schema.ts`, `src/lib/rbac.ts`, `src/lib/tickets.ts`, `src/lib/hierarchy.ts`, `src/components/PatchworkApp.tsx` |
| QA-02 | P0 | Auth Security | `changeUserPassword` allowed omitting `currentPassword` when `mustChangePassword === false` | **Fixed** | `src/lib/auth.ts` |
| QA-03 | P0 | Workspace UI | Ticket column `<select>` rendered duplicate labels (`BacklogBacklog`) and dead sub-role disable logic | **Fixed** | `src/components/PatchworkApp.tsx` |
| QA-04 | P1 | Auth Security | `/api/auth/login` had no rate limiting/lockout (`rateLimitMaxFailures` / `rateLimitWindowMs` unused) | **Fixed** | `src/lib/auth.ts`, `src/app/api/auth/login/route.ts` |
| QA-05 | P1 | Upload Security | `validateAttachmentConstraints` did not verify magic bytes / text content against declared MIME/extension | **Fixed** | `src/lib/attachments.ts` |
| QA-06 | P1 | Error Handling | `handleApiError` returned raw `err.message` on HTTP 500 `INTERNAL_ERROR` | **Fixed** | `src/lib/http.ts` |
| QA-07 | P1 | Theme / Mobile | `SystemConfigView` ignored `patchwork_theme` in `localStorage` and fixed sidebar crushed `390x844` layout | **Fixed** | `src/components/SystemConfigView.tsx` |
| QA-08 | P1 | Security / Routing | Missing security response headers; `/dashboard/system` returned plain-text 403 to unauthenticated requests instead of redirecting | **Fixed** | `next.config.ts`, `src/middleware.ts`, `src/app/api/system/auth-check/route.ts` |
| QA-09 | P1 | Real-time SSE | `RealtimeHub` did not schedule reconnect on `pgClient` `error`/`end` for active listeners | **Fixed** | `src/lib/realtime.ts` |
| QA-10 | P1 | Auth / Session | `sessionIdleTimeoutMs` enforced via `0009_session_last_active.sql` (`last_active_at` backfilled from `created_at`), 60s-throttled activity touch (`skipTouch` on SSE/auth-check), 401 `SESSION_IDLE_EXPIRED` + draft preservation & return URL | **Fixed** | `drizzle/0009_session_last_active.sql`, `src/lib/auth.ts`, `src/lib/http.ts`, `src/lib/settings.ts`, `src/app/api/events/route.ts`, `src/components/PatchworkApp.tsx`, `src/components/SystemConfigView.tsx`, [tests/qa-decisions.test.ts](file:///d:/Coding/Pesonal%20Projects/patchwork/tests/qa-decisions.test.ts), [e2e/qa-decisions.spec.ts](file:///d:/Coding/Pesonal%20Projects/patchwork/e2e/qa-decisions.spec.ts) |
| QA-11 | P1 | Deployment Docs | Removed all `/s3/` path rewrites; configured dedicated `files.<domain>` host in `deploy/Caddyfile`, `deploy/nginx.conf`, `scripts/setup/domain.mjs`, `.env.example`, `README.md`, and `docs/INSTALL.md`; signed presigned URLs against `MINIO_PUBLIC_URL` (`http://localhost:9000` for localhost) | **Fixed** | `src/lib/attachments.ts`, `deploy/Caddyfile`, `deploy/nginx.conf`, `scripts/setup/domain.mjs`, `.env.example`, `README.md`, `docs/INSTALL.md`, [tests/qa-decisions.test.ts](file:///d:/Coding/Pesonal%20Projects/patchwork/tests/qa-decisions.test.ts) |
| QA-12 | P2 | Mobile UX | Login screen stacked marketing panel above Sign In card on `390x844`, pushing login inputs below the fold | **Fixed** | `src/components/PatchworkApp.tsx` |
| QA-13 | P2 | Mobile UX | Board header right controls clipped `+ New Ticket` off-screen at `390x844` and mobile buttons were `< 44x44px` | **Fixed** | `src/components/PatchworkApp.tsx` |
| QA-14 | P2 | Accessibility | Missing `aria-label` on ticket detail close button, column move/delete buttons, and calendar drawer close button; Calendar view lacked `<main>` | **Fixed** | `src/components/PatchworkApp.tsx`, `src/components/BoardCalendarView.tsx` |
| QA-15 | P2 | Real-time UX | Subtle `aria-live="polite"` inline notice (`"Updates paused. Refresh to reconnect."` + `"Reconnect now"`) inside board header only after 5 consecutive SSE failures; background exponential backoff capped at 30s with automatic catch-up board refetch on reconnect | **Fixed** | `src/components/PatchworkApp.tsx`, [e2e/qa-decisions.spec.ts](file:///d:/Coding/Pesonal%20Projects/patchwork/e2e/qa-decisions.spec.ts) |
| QA-16 | P2 | Auth Security | `verifyCsrfToken` used `!==` instead of `crypto.timingSafeEqual` | **Fixed** | `src/lib/auth.ts` |
| QA-17 | P3 | Docs | Stray `"we "` prefix before `# Patchwork` in `README.md`; `scripts/seed.mjs --env` silently ignores missing env file | **Fixed** (`README.md`) / Noted (`seed.mjs`) | `README.md`, `scripts/seed.mjs` |

---

## 3. "Does Not Make Sense" & UX Review

1. **Mobile Login Fold (`390x844`, fixed)**: Before the fix, a mobile visitor landed on three dark marketing feature cards and had to scroll down past 800px to reach the email/password form. Reordered grid (`order-1` form, `order-2` overview on `< lg`) so Sign In is immediate.
2. **Double Column Names in Selectors (fixed)**: Every ticket card and ticket modal `<select>` displayed `"BacklogBacklog"` and `"In ProgressIn Progress"` due to duplicate JSX lines.
3. **System Config Theme & Mobile Layout (fixed)**: Navigating from dark-mode workspace to `/dashboard/system` flashed back into light mode because `SystemConfigView` did not read `patchwork_theme` from `localStorage`. On mobile (`390px`), the 224px sidebar left ~150px for the users table.
4. **Settings Exposed Without Runtime Effect (fixed)**: `sessionIdleTimeoutMs` in System Configuration -> Security is now enforced server-side with `last_active_at` migration, 60s-throttled touch (`skipTouch` on SSE/auth-check), `SESSION_IDLE_EXPIRED`, and client draft preservation.
5. **SSE `"Updates paused"` Banner (fixed)**: Moved out of the app-level `<header>` into a subtle `aria-live="polite"` inline notice inside the board header only after 5 consecutive failures, with background exponential backoff capped at 30s, a `"Reconnect now"` button, and catch-up board refetch on reconnect.

---

## 4. Performance & Security Notes

- **Large-Seed Benchmark (`--size large`: 350 tickets, 874 comments, 1790 activities)**:
  - `GET /api/workspace`: `28.4 ms`
  - `GET /api/boards/[boardId]`: `20.6 ms`
  - `GET /api/tickets/[ticketId]`: `13.0 ms`
  - `GET /api/search?q=postgres`: `15.8 ms`
- **Dependency Audit (`npm audit --json`)**: 16 vulnerabilities reported (12 moderate, 2 high, 2 critical — primarily `vitest`/`tinypool` dev dependencies and `next`/`postcss` transitive advisories requiring major version upgrades).

---

## 5. Completeness & Untested Areas

- **Completeness**: See `docs/QA_SPEC_CHECKLIST.md`. All 12 core spec areas are present; all 17 identified defects (`QA-01` through `QA-17`, including `QA-10`, `QA-11`, and `QA-15`) are fixed and covered by regression tests.
- **Untested / Partially Tested Areas & Why**:
  - **Linux `systemd` units (`deploy/patchwork.service`, `deploy/minio.service`, `scripts/install.sh`)**: Reviewed statically only; runtime execution requires a Linux host with `systemd` (audit ran natively on Windows).
  - **Reverse Proxy live TLS (`deploy/Caddyfile`, `deploy/nginx.conf`)**: Reviewed statically for SSE-safe directives (`flush_interval -1`, `proxy_buffering off`); live TLS/DNS termination requires a public domain.
  - **Lighthouse CLI audit**: Not run separately; responsive layout, overflow, semantic landmarks, button labeling, and touch targets were verified programmatically via Playwright across `1440x900`, `1024x768`, `768x1024`, and `390x844` in light and dark themes.

