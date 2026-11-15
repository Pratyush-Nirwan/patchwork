# Patchwork UI Polish, Motion System & Skeleton Loaders Plan

## 1. Performance & Visual Baseline (Step 0 Audit)

Captured against seeded `patchwork_test` (`--size medium --seed 42`: 1 org, 4 teams, 25 users, 10 projects, 10 boards, 60 columns, 150 tickets, 357 comments, 749 activities, 30 attachments) with `next build` + `next start`.

### Bundle Size Baseline (`next build`)
| Route | Page Size | First Load JS |
| --- | --- | --- |
| `/` | 58 kB | 182 kB |
| `/setup` | 14.9 kB | 135 kB |
| `/dashboard/system/[[...section]]` | 21.2 kB | 128 kB |
| Shared First Load JS | — | 103 kB |

**Budget**: Keep initial bundle size increase `<= 10 KB` gzipped on main routes, `CLS <= 0.05` on every screen, `<= 5%` INP regression, and 60 fps during drag, panel, and dialog animations.

### Runtime Baseline (`baseline-audit.mjs`, 1440x900 & 390x844, Light & Dark)
| Viewport & Theme | Board Load (ms) | Workspace CLS | System CLS | Max Event Latency (ms) |
| --- | --- | --- | --- | --- |
| Desktop Light (`1440x900`) | 1320 | 0 | 0 | 0 |
| Desktop Dark (`1440x900`) | 1254 | 0 | 0 | 0 |
| Mobile Light (`390x844`) | 1193 | 0 | 0 | 0 |
| Mobile Dark (`390x844`) | 1132 | 0 | 0 | 0 |

"Before" screenshots saved in `scratch/before/` covering `login`, `board`, `ticket`, `palette`, and `system` across all 4 viewport/theme combinations.

---

## 2. Screen-by-Screen Audit & Planned Fixes

| Screen / Component | Current Loading Behavior | Current Motion & UX Issues | Planned Skeleton / Animation / Polish |
| --- | --- | --- | --- |
| **Root Layout & Theme (`layout.tsx`, `globals.css`)** | No pre-paint theme script; dark mode flashes white on hard reload. No `loading.tsx` route fallbacks. | No shared motion tokens, no `prefers-reduced-motion` global rules, no `scrollbar-gutter: stable`, default browser `::selection` & focus rings. | Inline pre-paint script in `layout.tsx` reading `patchwork_theme` and `patchwork_reduce_motion` inside `try/catch`. Global motion tokens, `scrollbar-gutter: stable`, themed `::selection` & `:focus-visible`, `prefers-reduced-motion`, `[data-reduce-motion="true"]`, `[data-test-animations="off"]`. |
| **Login (`PatchworkApp.tsx`)** | Instant render after workspace boot check (`"Loading Patchwork dispatch workspace..."` plain text). | Abrupt swap from loading text to split login view; no button loading feedback on sign-in. | `WorkspaceSkeleton` on initial auth check; smooth `Fade` entrance on login form; spinner + disabled state on sign-in submit. |
| **Setup Wizard (`SetupWizard.tsx`, `/setup`)** | Plain text `"Loading Patchwork first-run initialization..."`. | Abrupt step transitions; no autosave feedback fade; no step completion confirmation check. | `src/app/setup/loading.tsx` + `SetupWizardSkeleton`; `Fade` on step changes; autosave `"Saved"` badge fade; subtle step check confirmation. |
| **Workspace & Kanban Board (`PatchworkApp.tsx`, `/`)** | Full-screen plain text `"Loading Patchwork dispatch workspace..."` on initial load. Board switch/filter refetches replace or pop in abruptly. | Ticket slide-over panel mounts/unmounts instantly (`null` return). Drag-and-drop lacks lift/drop/FLIP feedback and rollback shake on error. Remote SSE updates pop in silently. On mobile (`390x844`), `left-sidebar` defaults open and overlays the board/toggle button. | `src/app/loading.tsx` + `WorkspaceSkeleton` + `BoardSkeleton` (with 150ms anti-flash delay / 300ms min hold). Stale-while-revalidate `opacity: 0.6` + thin `RevalidateBar` on board/filter switches. `Slide`+`Fade` ticket drawer, DnD lift/drop/rollback motion, 1.2s remote update highlight (skipping off-screen & bulk catch-up), mobile sidebar closed by default `< 768px` with backdrop dismiss. |
| **Board Calendar View (`BoardCalendarView.tsx`)** | Renders inline when switched; day modal pops in without transition. | Abrupt month switch and day-detail modal mount. | `Scale`+`Fade` on day modal; smooth month grid transition; button press feedback. |
| **Ticket Detail Panel & Activity (`PatchworkApp.tsx`)** | Opens instantly; sub-sections pop in when `ticketDetails` arrives. | No skeleton while fetching ticket details; copy-link & save buttons lack visual confirmation; image attachments pop in without fade. | `TicketPanelSkeleton` on ticket fetch; `Fade` on loaded details; copy button checkmark confirmation; image `opacity` fade-in on load; avatar initials fallback. |
| **Command Palette (`CommandPalette.tsx`, `ui/command.tsx`)** | Returns `null` when closed; search results pop in abruptly. | Instant mount/unmount without scale/fade; no loading skeleton during async search. | `Scale` (0.97 -> 1) + `Fade` dialog entrance/exit; `SearchPaletteSkeleton` during async search. |
| **System Configuration (`SystemConfigView.tsx`, `/dashboard/system/[[...section]]`)** | Plain `"Loading system configuration..."`, `"Loading users..."`, `"Loading hierarchy..."`, `"Loading permissions..."` text/spinners. | Section switches pop in abruptly; toast notifications appear/disappear without motion; action buttons lack consistent loading states. | `src/app/dashboard/system/[[...section]]/loading.tsx` + `SystemConfigSkeleton` (users, hierarchy, permissions, generic section variants); `Fade` on section content; smooth toast enter/exit. |
| **Account Settings (`UserSettingsModal.tsx`)** | Returns `null` when closed. | No modal enter/exit transition; missing `"Reduce motion"` preference. | `Scale`+`Fade` modal transition; `"Reduce motion"` toggle persisted in `localStorage` (`patchwork_reduce_motion`, wrapped in `try/catch`) + synced to `document.documentElement.dataset.reduceMotion`. |
| **Snackbar (`AppSnackbar.tsx`)** | Returns `null` when `!snackbar`. | Instant pop-in/out; no auto-dismiss progress indicator; no touch swipe-to-dismiss. | `Slide`+`Fade` enter/exit, subtle progress bar pausing on hover/focus, pointer/touch swipe-to-dismiss. |

---

## 3. Motion & Loading Architecture

1. **Zero Heavy Dependencies**: Built strictly with CSS custom properties, keyframes (`transform` and `opacity` only), and lightweight React hooks/primitives.
2. **Motion Tokens (`src/app/globals.css`)**:
   - Durations: `--pw-dur-instant: 0ms`, `--pw-dur-fast: 120ms`, `--pw-dur-base: 180ms`, `--pw-dur-slow: 260ms`, `--pw-dur-page: 320ms`.
   - Easings: `--pw-ease-out: cubic-bezier(0.16, 1, 0.3, 1)`, `--pw-ease-in: cubic-bezier(0.7, 0, 0.84, 0)`, `--pw-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)`.
   - Distances: `--pw-dist-xs: 4px`, `--pw-dist-sm: 8px`, `--pw-dist-md: 16px`.
   - Stagger: `--pw-stagger-step: 24ms` (capped at 12 items).
   - Reduced motion: `@media (prefers-reduced-motion: reduce)`, `[data-reduce-motion="true"]`, and `[data-test-animations="off"]` collapse durations to `0ms` / instant opacity transitions and disable shimmer.
   - Background tab pause: `.pw-tab-hidden * { animation-play-state: paused !important; }` toggled via `visibilitychange`.
3. **Anti-Flash Skeletons & Stale-While-Revalidate (`src/lib/motion.ts`, `src/components/ui/skeleton.tsx`)**:
   - `useAntiFlashLoading(isLoading)`: waits `150ms` before showing skeleton; once shown, holds for at least `300ms` to prevent flicker.
   - `SkeletonRegion`: sets `aria-busy`, `aria-hidden="true"` on placeholder shapes, and announces loading/ready states in a polite `aria-live` region.
   - `RevalidateBar`: thin top progress bar + `opacity: 0.6` on stale content during refetches (never replaces existing content with a skeleton).
4. **Error & Route Boundaries (`src/components/ui/motion.tsx`)**:
   - `RegionErrorBoundary` for isolated fallback + retry on major workspace/system regions.
   - `loading.tsx` in `/`, `/setup`, and `/dashboard/system/[[...section]]` for instant App Router navigation feedback.

---

## 4. Design Decisions (Safest Professional Defaults)

- **Mobile Sidebar Default**: On initial mount when `window.innerWidth < 768`, default `sidebarOpen` to `false` so the board is immediately interactive on mobile instead of being covered by the fixed drawer, and add a tap-outside backdrop when open on mobile.
- **In-App Reduce Motion**: Store in `localStorage` (`patchwork_reduce_motion`) wrapped in `try/catch` and apply `data-reduce-motion="true"` on `<html>` before paint so it works identically to OS `prefers-reduced-motion`.
- **Test Determinism**: Support `window.__PATCHWORK_TEST_DISABLE_ANIMATIONS__` / `data-test-animations="off"` / `NEXT_PUBLIC_DISABLE_ANIMATIONS=1` for Playwright/unit test determinism.
