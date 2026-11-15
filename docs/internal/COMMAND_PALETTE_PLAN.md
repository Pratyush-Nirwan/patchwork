# Command Palette Plan (Step 0)

## 1. Existing Codebase Inventory

### Search & Full-Text Search
- **`src/lib/search.ts`**: `searchWorkspace(userId, rawQuery, { orgId, limit })` queries `tickets`, `comments`, and `attachments` (`extracted_text`) using PostgreSQL `websearch_to_tsquery('english', $1)`, `ts_rank_cd`, and `ts_headline` (`<mark>` highlights). Enforces access control via `getAccessibleTeamIds(userId, orgId)`.
- **`src/app/api/search/route.ts`**: `GET /api/search?q=...&orgId=...` authenticates via `requireRequestAuth(req, { skipCsrf: true })` and returns `{ results }`.
- **`src/components/PatchworkApp.tsx` (lines 2543–2632)**: Inline `<input data-testid="global-search-input">` in `<header>` with a 250ms debounced fetch to `/api/search` and dropdown `<div data-testid="search-results">`.
- **E2E dependencies**: `e2e/patchwork.spec.ts` (lines 221–227) and `e2e/seed.spec.ts` (lines 56–60) interact directly with `data-testid="global-search-input"` and `data-testid="search-results"`.

### Keyboard Shortcuts & Modals
- **`src/components/PatchworkApp.tsx` (lines 1196–1250)**: Global `window` `keydown` listener handles:
  - `Cmd/Ctrl + K`: focuses `searchInputRef` and opens inline search dropdown.
  - `Escape`: closes search dropdown, open modals (`showNewTicket`, `showNewColumn`, `showShortcutsModal`, `showTeamMembersModal`), or `selectedTicketId`.
  - `/` (outside inputs): focuses `searchInputRef` and opens inline search dropdown.
  - `c` (outside inputs, non-viewer): opens New Ticket modal.
  - `[` (outside inputs): toggles sidebar.
  - `?` (outside inputs): toggles `showShortcutsModal`.
- **Conflict notes**:
  - `Cmd/Ctrl + K` and `/` currently target the inline header `<input>`. Moving them to open the Spotlight command bar replaces the inline dropdown behavior.
  - `Cmd/Ctrl + /` is currently unbound and does not conflict with `?`.

### Server Actions, Libs, and Permissions
- **`src/lib/rbac.ts`**: `getOrgRole`, `getEffectiveTeamRole`, `requireOrgAdmin`, `requireOrgMember`, `requireTeamRole`, `requireProjectRole`, `requireBoardRole`, `requireTicketRole`, `getAccessibleTeamIds`, `PERMISSIONS_MATRIX`.
- **`src/lib/tickets.ts`**: `createTicket`, `updateTicket` (title, description, priority, labels, assigneeId, dueDate), `moveTicket` (enforces sub-role workflow transitions & WIP limits), `deleteTicket`, `getTicketFullDetails`.
- **`src/lib/comments.ts`**: `addComment`.
- **`src/lib/links.ts`**: `addTicketLink`, `removeTicketLink`.
- **`src/lib/hierarchy.ts`**: `getFullWorkspaceTree`, `getBoardWithDetails`, `createColumn`, `listTeamMembers`, `listProjectBoards`, `listTeamProjects`, `listOrgTeams`.
- **API routes**: `/api/boards/[boardId]/tickets`, `/api/tickets/[ticketId]`, `/api/tickets/[ticketId]/move`, `/api/tickets/[ticketId]/comments`, `/api/tickets/[ticketId]/links`, `/api/boards/[boardId]/columns`, `/api/workspace`, `/api/auth/me`, `/api/auth/logout`.

### Theme, Account, & Design Tokens
- **`src/app/globals.css`**: CSS custom properties (`--pw-bg`, `--pw-surface`, `--pw-surface-muted`, `--pw-surface-hover`, `--pw-ink`, `--pw-ink-secondary`, `--pw-ink-muted`, `--pw-border`, `--pw-accent`, `--pw-accent-hover`, `--pw-accent-soft`, `--pw-urgent`, `--pw-high`, `--pw-medium`, `--pw-low`, `--pw-success`, `--pw-shadow`, `--font-mono`, `.dark` overrides).
- **`src/components/PatchworkApp.tsx`**: `darkMode` + `toggleTheme` (`localStorage` key `patchwork_theme`), `handleLogout` (`POST /api/auth/logout`), admin link to `/dashboard/system`.
- **Platform helper**: `src/lib/platform.ts` (server/Node path/platform utilities). No browser OS shortcut helper exists yet.

### Gaps / Missing Capabilities Found
1. **Single-ticket archive**: `tickets` table in `src/db/schema.ts` has no `archivedAt`/`isArchived` column, and `src/lib/tickets.ts` has no `archiveTicket` function (only `POST /api/system/danger/archive-tickets` exists for admin bulk purge of old tickets).
2. **User account settings UI**: Non-admin users have no dedicated `/settings` modal or page (only admin `/dashboard/system` and footer buttons for shortcuts, theme, and logout).
3. **Board filter state**: `PatchworkApp.tsx` does not currently have client-side filter state (`priority`, `assignee`, `label`) for `/filter` commands.
4. **UI primitives**: `cmdk` is not yet in `package.json` and `src/components/ui/` does not exist yet.

---

## 2. What Will Be Reused
- `searchWorkspace` (`src/lib/search.ts`) and `getAccessibleTeamIds` (`src/lib/rbac.ts`) for FTS and team-scoped authorization.
- Existing domain functions (`createTicket`, `updateTicket`, `moveTicket`, `deleteTicket`, `addComment`, `addTicketLink`, `createColumn`, `getBoardWithDetails`, `getFullWorkspaceTree`) — zero duplicated business logic or second permission system.
- Existing `PatchworkApp.tsx` navigation, modal, theme, and logout handlers (`setActiveBoardId`, `setSelectedTicketId`, `setBoardViewMode`, `setSidebarOpen`, `toggleTheme`, `handleLogout`, `apiFetch`).
- Existing `--pw-*` CSS variables in `src/app/globals.css`.

---

## 3. What Will Be Added
1. **Dependency**: `cmdk` (accessible combobox/command dialog primitive used by shadcn/ui `Command`; minimal footprint, no other dependencies).
2. **Browser OS & Shortcut Utility (`src/lib/shortcuts.ts`)**:
   - Single place for browser OS detection (macOS vs Windows/Linux) to format `Mod` as `⌘` or `Ctrl`.
   - Default shortcut definitions, conflict validator, and user-scoped `localStorage` persistence for customized shortcuts.
3. **Typed Command Registry & Parser (`src/lib/commands/registry.ts`, `src/lib/commands/parser.ts`)**:
   - Single typed registry defining every slash command, aliases, arguments, argument types/autocompleters, permission hints, and execution metadata.
   - Safe parser for `/command arg1 "quoted arg"` and search filter tokens (`in:`, `status:`, `priority:`, `assignee:`, `label:`, `due:`, `has:`).
4. **Server Command Execution (`POST /api/commands/execute`)**:
   - Zod-validated command dispatch calling existing `tickets.ts`, `comments.ts`, `links.ts`, and `hierarchy.ts` functions (server-side RBAC + workflow rules enforced on every call).
   - Never logs search queries, ticket content, or command arguments with personal data.
5. **Extended Scoped Search (`GET /api/search` & `src/lib/search.ts`)**:
   - Reuses FTS for tickets, comments, attachments and adds scoped search across boards, projects, teams, people, and labels, plus filter token support.
   - Returns grouped results strictly scoped to `getAccessibleTeamIds(userId, orgId)`.
6. **Spotlight Command Bar UI (`src/components/ui/command.tsx`, `src/components/CommandPalette.tsx`)**:
   - Replaces/upgrades the header search with a Spotlight trigger button + modal `CommandDialog` (accessible via `Cmd/Ctrl+K`, `/`, or click).
   - Supports empty-state recent items (scoped per user ID, cleared on logout/user switch), grouped search results, slash command mode with argument autocompletion, inline confirmation for destructive actions (`/delete`), Help view (`Cmd/Ctrl+/`), and board filtering (`/filter`).
   - User-facing Shortcut & Preferences Modal (for `/settings` and shortcut customization + reset to defaults).
7. **Documentation (`docs/COMMAND_PALETTE.md`)**: Architecture, command reference, shortcut customization, and security model.

---

## 4. Open Questions / Decisions Needed Before Coding
1. **Header Search Bar vs. Spotlight Trigger (`e2e` compatibility)**:
   - Should the header `<input data-testid="global-search-input">` be replaced with a compact Spotlight trigger button (moving `data-testid="global-search-input"` onto the Spotlight dialog input and updating `e2e/patchwork.spec.ts` / `e2e/seed.spec.ts` to click/open the palette first)?
2. **`/archive <key>` command**:
   - Single-ticket soft-archiving does not exist in `src/db/schema.ts` or `src/lib/tickets.ts`. Should `/archive <key>` be omitted in favor of `/delete <key>` (with confirmation), or should a new `archived_at` column + migration + `archiveTicket` helper be added?
3. **User Settings (`/settings`)**:
   - Non-admin users currently have no `/settings` UI. Should `/settings` open a new lightweight **User Preferences & Shortcuts Modal** (shortcut customization + theme), while `/system` opens `/dashboard/system` for admins?
4. **Shortcut Reassignment**:
   - Confirm replacing `Cmd/Ctrl+K` and `/` inline header focus with opening the Spotlight Command Bar, and binding `Cmd/Ctrl+/` to toggle the Command Bar Help view (keeping `?` for the Keyboard Shortcuts modal).

