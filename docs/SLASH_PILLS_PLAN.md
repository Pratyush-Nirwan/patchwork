# Slash Command Inline Pills Plan

## 1. Root Cause of Spacing Bug & Current Limitations

1. **Trailing-space measurement gap (`3.84px`)**: In `src/components/ui/command.tsx`, `CommandInput` overlays `command-ghost-layer` at `left: textOffsetInView`. After typing `/new `, `mirrorEl` (`whitespace-pre`) measures `"/new "` where a single `14px` space is `~3.84px` wide, and `buildSlashGhostHint()` sets `needsLeadingSpace: false` when `hasTrailingSpace` is `true`. The first hint pill therefore starts `3.84px` after `/new`, below the `8px` minimum.
2. **Disappearing hint pills**: `buildSlashGhostHint()` clears `activeSegment` as soon as the user starts typing an argument value, so typed text sits outside any pill while the hint disappears or floats separately.
3. **Uncommitted format mismatch**: Old hint pills used red/slate colors distinct from `--pw-ghost-active` / `--pw-ghost-rest`, and `formatUsage()` used bare positional labels without the `label:` convention.

## 2. Argument Types per Registered Command (`src/lib/commands/registry.ts`)

Add `argType: "word" | "text" | "choice"` to `CommandArgSpec` and `CommandOptionSpec`:

| Command | Positional Args (`argType`) | Optional Keys (`argType`) |
|---|---|---|
| `new` | `title` (`text`) | `column` (`choice`), `priority` (`choice`), `assignee` (`word`), `label` (`word`) |
| `open` | `ticket` (`word`) | — |
| `move` | `ticket` (`word`), `column` (`choice`) | — |
| `assign` | `ticket` (`word`), `@user` (`word`) | — |
| `priority` | `ticket` (`word`), `level` (`choice`) | — |
| `label` | `ticket` (`word`), `tag` (`word`) | — |
| `due` | `ticket` (`word`), `date` (`word`) | — |
| `comment` | `ticket` (`word`), `text` (`text`) | — |
| `link` | `ticket` (`word`), `url` (`word`) | — |
| `archive` | `ticket` (`word`) | — |
| `delete` | `ticket` (`word`) | — |
| `go` | `target` (`choice`) | — |
| `view` | `mode` (`choice`) | — |
| `filter` | `expr` (`word`) | — |
| `column` | `name` (`text`) | `wip` (`word`) |
| `theme` | `mode` (`choice`) | — |
| `help` | `command` (`choice`) | — |
| `docs` | `topic` (`choice`) | — |
| `sidebar`, `members`, `settings`, `system`, `me`, `logout` | — | — |

Rules:
- `word`: `Space` ends the argument and advances to the next required pill (or stays if none).
- `text`: `Space` is literal; ends only on `Tab`, `Enter`, or adding an optional pill.
- `choice`: `Space` stays literal while typed text is a case-insensitive prefix of at least one option containing a space (e.g. `"In "` -> `"In Progress"`); otherwise `Space` ends the argument.

## 3. Canonical Serialization & Shared Parser (`src/lib/commands/parser.ts`)

- Canonical form: `/command label: value label: value`, quoting `value` only when it contains a recognized `label:` token or leading/trailing whitespace.
- `parseSlashCommand(input, def)` accepts:
  1. Canonical `label: value` form (both positional labels and option keys, multi-word values until next recognized `label:` token).
  2. Legacy `key:value` form without space after colon.
  3. Positional form (`/move PAY-12 "In Review"`, `/new "Fix login" priority:high`).
- `route.ts` continues to receive `{ command, positional, flags, rawArgs, context }` and re-validates with existing zod schemas and RBAC.

## 4. Inline Pill UI Architecture (`src/components/command-palette/SlashPillRow.tsx` + `src/components/ui/command.tsx`)

- **Native `<input>` per pill** inside a single field container (`role="group" aria-label="Command"`):
  - Keeps native IME composition, caret, selection, copy/paste, and spellcheck.
  - Each pill renders non-editable `label:` text + single space + auto-sized `<input>` (via hidden `whitespace-pre` mirror `<span>`, `placeholder={spec.typeName}`), styled identically before, during, and after typing using the shared `--pw-ghost-*` / `--pw-surface-muted` / `--pw-border` tokens (adjusted in `src/app/globals.css` to meet WCAG AA `>= 4.5:1` in light and dark).
  - Horizontal padding `8px` (`px-2`), vertical padding keeping input row height unchanged, `8px` (`gap-2`) between command text and first pill and between pills, and `12px` (`ml-3`) before non-editable ghost optional pills.
- **Navigation, Editing, Undo/Redo**:
  - `ArrowLeft`/`ArrowRight` at input boundary crosses to adjacent pill (skipping non-editable labels) or command text.
  - `Tab` accepts highlighted suggestion and advances to next required pill or next ghost optional pill; `Shift+Tab` moves back.
  - `Backspace` in empty pill removes that pill and focuses previous pill end (or un-commits command when last pill is removed); `Delete` at end of a value mirrors removal/merge where appropriate.
  - `Paste` of a full command (positional, legacy `key:value`, or canonical) parses into pills; plain text paste into a pill replaces newlines with spaces.
  - Single coherent undo/redo stack (`Ctrl/Cmd+Z`, `Shift+Ctrl/Cmd+Z`) across pill additions, removals, and value edits.
- **Accessibility & Responsive**:
  - Active pill input carries `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`; polite live region announces `"Argument X of Y: <label>, required|optional"` and `"<label> removed"`.
  - Wraps up to 2 lines then scrolls vertically; `44px` touch targets at `<= 640px`; mobile Accept bar anchored above `visualViewport` keyboard.
