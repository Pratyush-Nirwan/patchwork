# Patchwork Skeleton & Loading State Audit

This document tracks every loading, initialization, and pending-data state across the Patchwork web app (`src/`) and documentation/marketing website (`website/src/`).

## Detection Summary

| Method | Scope | Findings |
| --- | --- | --- |
| 1. Static Search | `src/` and `website/src/` regex scan for loading text, spinners, `animate-spin`, `role="progressbar"`, `fallback={null}`, `loading.tsx` gaps, `<Image>`/`<img>` tags | 19 |
| 2. Runtime Latency Sweep | Playwright sweep with `PATCHWORK_TEST_LATENCY_MS=1800` across roles (admin, team lead, member, viewer, unauthenticated) at 1440×900 & 390×844 in light & dark | 16 (verified against static + inventory) |
| 3. Component Inventory by Screen | Full screen-by-screen audit (boot, auth, setup, dashboard/board, ticket panel, search, command palette, notifications, account settings, all 11 System Configuration sections, docs/website) | 28 |
| 4. Component Library Scan | Shared primitives (`Skeleton`, `SkeletonRegion`, `Surface`, `MentionTextarea`, `TicketWatcherControls`, `NotificationInbox`, `HoldToConfirmButton`, tables, modals) | 8 |

Cross-method reconciliation:
- Static search caught explicit text literals (`Loading diagnostics...`, `Loading status...`, `Searching members...`, `Loading preferences...`, `Loading...` in Load More buttons) and spinners (`SearchSection.tsx:116`).
- Component inventory caught **silent/blank fetches** that had no `loading` variable at all (`AppearanceSection`, `IntegrationsSection`, `DataBackupSection`, `DangerZoneSection` previews, `NotificationsSection` email logs & webhook deliveries, `StorageSection` orphan scan).
- Component library scan caught hardcoded skeleton colors (`--pw-skeleton-base`, `bg-[var(--pw-rail-surface)]` in `WorkspaceSkeleton`), missing `Surface` wrappers, and missing `forced-colors` / `prefers-contrast: more` rules.

---

## Audit Table

| # | File / Route | Component | Method(s) | Current Behavior | Planned Skeleton / Fix | Verification / Allowlist | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `src/app/globals.css` | Global skeleton tokens | Library, Static | Hardcoded `--pw-skeleton-base` (`#E6E3DC` / `#1D252F`) and white-alpha highlight; no per-surface derivation, no `forced-colors` outline, no `prefers-contrast: more` boost | Surface-derived `--sk-surface`, `--sk-ink`, `--sk-base`, `--sk-shine` via `color-mix(in oklab, ...)` with solid fallbacks for every surface type in light & dark | `e2e/skeleton-audit.spec.ts` (OKLCH color & contrast suite) | Done |
| 2 | `src/components/ui/skeleton.tsx` | `Surface`, `Skeleton`, `SkeletonRegion` | Library | No `Surface` primitive to propagate `--sk-surface` on nested containers; `Skeleton` uses global color regardless of background | Add `Surface` component (`data-sk-surface`) covering all surface variants (`page`, `surface`, `rail`, `card`, `panel`, `popover`, `dialog`, `table-header`, `table-row`, `table-stripe`, `table-hover`, `table-selected`, `input`, `toast`, `tooltip`, `command`, `code`, `accent`, `success`, `warning`, `destructive`, `info`, `chip`) | `tests/skeleton-enforcement.test.ts` + `e2e/skeleton-audit.spec.ts` | Done |
| 3 | `src/components/skeletons/WorkspaceSkeleton.tsx` | `WorkspaceSkeleton` | Static, Inventory, Library | Manual `bg-[var(--pw-rail-surface)]` overrides on rail skeletons; `SkeletonCircle` in rail footer uses light-mode color on dark rail | Wrap rail in `<Surface variant="rail">`, header in `<Surface variant="surface">`, remove manual `bg-[var(--pw-rail-surface)]` overrides | `e2e/skeleton-audit.spec.ts` | Done |
| 4 | `src/components/skeletons/BoardSkeleton.tsx` | `BoardSkeleton` | Inventory, Library | Columns & cards do not set `--sk-surface` | Wrap column in `<Surface variant="surface">` and card in `<Surface variant="card">` | `e2e/skeleton-audit.spec.ts` | Done |
| 5 | `src/components/skeletons/TicketPanelSkeleton.tsx` | `TicketPanelSkeleton` | Inventory, Runtime | Top bar skeleton still shows 3 controls on left (mismatch with updated header where Status/Priority moved under Assignee/Due Date) | Match exact ticket panel geometry: key on left, watchers + close on right; Assignee/Due Date + Status/Priority rows under title; wrap in `<Surface variant="surface">` & `<Surface variant="card">` | `e2e/skeleton-audit.spec.ts` (geometry parity) | Done |
| 6 | `src/components/PatchworkApp.tsx` | Ticket detail drawer | Inventory, Runtime | Uses `ticketLoading` directly without anti-flash (`150ms` delay / `300ms` hold) or stale-while-revalidate when switching tickets | Use `SkeletonRegion` with `TicketPanelSkeleton` and `isRevalidating` progress bar | `e2e/skeleton-audit.spec.ts` | Done |
| 7 | `src/components/MentionTextarea.tsx` | `@mention` picker dropdown | Static, Inventory, Runtime | Plain text `"Searching members..."` while fetching `/api/tickets/[id]/mentionable` | Replace with 3 compact `SkeletonCircle` + `Skeleton` rows inside `<Surface variant="popover">` with anti-flash `useAntiFlashLoading` | `e2e/skeleton-audit.spec.ts` | Done |
| 8 | `src/components/NotificationInbox.tsx` | Notification list & Load More | Static, Inventory, Runtime | Initial load renders `<div className="min-h-[160px]" />` before 150ms; Load More button shows `"Loading..."` text instead of skeleton rows | Wrap popover in `<Surface variant="popover">`; when `loadingMore`, append 2 geometry-matched notification skeleton rows at bottom of list | `e2e/skeleton-audit.spec.ts` | Done |
| 9 | `src/components/TicketWatcherControls.tsx` | Watchers popover Load More | Static, Inventory, Runtime | Load More button shows `"Loading..."` text | Wrap popover in `<Surface variant="popover">`; when `loadingMore`, render 2 watcher skeleton rows at end of list | `e2e/skeleton-audit.spec.ts` | Done |
| 10 | `src/components/UserSettingsModal.tsx` | Account settings -> Notifications tab | Static, Inventory, Runtime | Plain text `"Loading preferences..."` while fetching `/api/account/notifications` | Replace with geometry-matched `NotificationPrefsSkeleton` inside `<Surface variant="dialog">` + `SkeletonRegion` | `e2e/skeleton-audit.spec.ts` | Done |
| 11 | `src/components/system/HealthDiagnosticsSection.tsx` | System Config -> Health & Diagnostics | Static, Inventory, Runtime | Plain text `"Loading diagnostics..."` | Replace with geometry-matched `HealthDiagnosticsSkeleton` (4 telemetry cards + worker card + error log list) inside `SkeletonRegion` | `e2e/skeleton-audit.spec.ts` | Done |
| 12 | `src/components/system/SearchSection.tsx` | System Config -> Search Index | Static, Inventory, Runtime | Plain text `"Loading status..."` | Replace with geometry-matched `SearchStatusSkeleton` (3 stat cards + rebuild action card) inside `SkeletonRegion` | `e2e/skeleton-audit.spec.ts` | Done |
| 13 | `src/components/system/AppearanceSection.tsx` | System Config -> Appearance | Inventory, Runtime | No `loading` state; flashes empty priorities/labels/columns before `/api/system/settings/appearance` resolves | Add `loading` state + `SkeletonRegion` with `SystemSectionSkeleton` while initial settings load | `e2e/skeleton-audit.spec.ts` | Done |
| 14 | `src/components/system/IntegrationsSection.tsx` | System Config -> Integrations | Inventory, Runtime | No `loading` state; flashes empty host list & token inputs before `/api/system/settings/integrations` resolves | Add `loading` state + `SkeletonRegion` with `SystemSectionSkeleton` while initial settings load | `e2e/skeleton-audit.spec.ts` | Done |
| 15 | `src/components/system/DataBackupSection.tsx` | System Config -> Data & Backup | Inventory, Runtime | `{commands && (...)}` renders blank right column until `/api/system/data/commands` resolves | Add `loading` state + `SkeletonRegion` with 2-command card skeleton so right column never jumps | `e2e/skeleton-audit.spec.ts` | Done |
| 16 | `src/components/system/DangerZoneSection.tsx` | System Config -> Danger Zone previews | Inventory, Runtime | Preview archive count & preview deactivated users fetch with no loading indicator | Add `previewArchiveLoading` & `previewDeactivatedLoading` states rendering inline `Skeleton` rows | `e2e/skeleton-audit.spec.ts` | Done |
| 17 | `src/components/system/NotificationsSection.tsx` | System Config -> Email Logs & Webhook Deliveries | Inventory, Runtime | Flashes empty state (`"No email deliveries recorded yet."` / `"No deliveries yet."`) while `loadEmailLogs` / `loadDeliveries` are in flight | Add `emailLogsLoading` & `deliveriesLoading` states with table-row skeletons inside `Surface` | `e2e/skeleton-audit.spec.ts` | Done |
| 18 | `src/components/system/StorageSection.tsx` | System Config -> Orphan Scan | Inventory, Runtime | No loading skeleton while scanning MinIO orphans | Add `scanningOrphans` state rendering orphan list skeleton rows | `e2e/skeleton-audit.spec.ts` | Done |
| 19 | `src/components/system/UsersSection.tsx` | System Config -> Users table | Inventory, Library | Uses raw `<Skeleton>` without `<Surface variant="table-row">` or anti-flash | Wrap table in `<Surface variant="surface">` and skeleton rows in `<Surface variant="table-row">` | `e2e/skeleton-audit.spec.ts` | Done |
| 20 | `src/components/system/RolesPermissionsSection.tsx` | System Config -> Roles Matrix | Inventory, Library | Uses raw `<Skeleton>` without `<Surface variant="table-row">` | Wrap matrix table in `<Surface variant="surface">` and skeleton rows in `<Surface variant="table-row">` | `e2e/skeleton-audit.spec.ts` | Done |
| 21 | `src/components/skeletons/SearchPaletteSkeleton.tsx` | Command Palette search results | Inventory, Library | Not wrapped in `<Surface variant="command">` | Wrap in `<Surface variant="command">` | `e2e/skeleton-audit.spec.ts` | Done |
| 22 | `src/components/skeletons/SetupWizardSkeleton.tsx` | Setup Wizard boot | Inventory, Library | Not wrapped in `<Surface variant="surface">` | Wrap card in `<Surface variant="surface">` and page in `<Surface variant="page">` | `e2e/skeleton-audit.spec.ts` | Done |
| 23 | `src/components/skeletons/SystemConfigSkeleton.tsx` | System Config shell & section skeletons | Inventory, Library | Not wrapped in `<Surface>` primitives | Wrap header/sidebar/cards in `<Surface variant="surface">` and page in `<Surface variant="page">` | `e2e/skeleton-audit.spec.ts` | Done |
| 24 | `website/src/styles/tokens.css` & `custom.css` | Docs & Marketing website skeletons & image placeholders | Static, Inventory | No surface-derived skeleton tokens (`--sk-surface`, `--sk-base`, `--sk-shine`); images lack surface placeholder background | Add matching surface-derived skeleton tokens, `forced-colors` / `prefers-contrast` / `prefers-reduced-motion` rules, and smooth image placeholder styling | `npm --prefix website run verify` + `e2e/skeleton-audit.spec.ts` | Done |
| 25 | `src/app/register/page.tsx` | `/register` route | Static | Calls `notFound()` synchronously (no data fetching) | Documented allowlist exception (does not fetch data) | `loading-allowlist.yaml` | Allowlisted |

---

## Allowed Exceptions (`loading-allowlist.yaml`)

| File | Pattern | Justification |
| --- | --- | --- |
| `src/components/PatchworkApp.tsx` | `authPending ? "Authenticating..." : ...`, `authPending ? "Updating..." : ...`, `uploadingAttachment ? "Uploading..." : ...` | In-button user-initiated pending state (allowed exception) |
| `src/components/system/SearchSection.tsx` | `<RefreshCw className={... animate-spin} />` + `"Rebuilding..."` | In-button user-initiated action spinner inside button (allowed exception) |
| `src/components/system/*Section.tsx` & `UserModals.tsx` | `{pending ? "Saving..." : ...}`, `"Adding..."`, `"Resetting..."`, `"Importing..."` | In-button user-initiated pending state (allowed exception) |
| `src/components/UserSettingsModal.tsx` | `{notifSaving ? "Saving..." : notifMsg}` | Short inline autosave status (allowed exception) |
| `src/components/system/HoldToConfirmButton.tsx` | `pending` prop inside destructive hold button | In-button user-initiated pending state (allowed exception) |
| `src/components/ui/motion.tsx` | `RouteProgressBar` (`role="progressbar"`) | Determinate/indeterminate thin top progress line for stale-while-revalidate & route transitions (allowed exception) |
| `src/app/register/page.tsx` | No `loading.tsx` | Route immediately calls `notFound()` with zero async data fetching |
