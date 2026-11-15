# Slash Command Inline Ghost Hints Plan (Step 0)

## 1. Current Argument UI Inspection

### Existing Files Inspected
- **`src/components/ui/command.tsx`**: Wraps `cmdk` (`Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandShortcut`). `CommandInput` renders a plain `<CommandPrimitive.Input>` with a leading search icon and optional clear button; there is no ghost overlay, mirror width measurer, composition tracking, or `aria-description` / live region.
- **`src/lib/commands/parser.ts`**: `tokenizeCommandInput` and `parseSlashCommand` tokenize quoted strings and `--flag value` options, but do not yet:
  - track token character spans/offsets for caret-based active argument detection,
  - parse `key:value` optional arguments in any order (or partial `key:` prefixes),
  - detect unknown option keys (with closest-match suggestions) or duplicate keys.
- **`src/lib/commands/registry.ts`**: `COMMAND_REGISTRY` defines each command's `args: CommandArgSpec[]` (`name`, `description`, `required`, `autocomplete`), but lacks:
  - display metadata (`label`, `typeName`, `keyed` / optional keyed options list per command such as `priority:level`, `assignee:@user`, `label:tag`, `column:col`, `wip:number`),
  - per-argument validation helpers for inline single-line error feedback.
- **`src/components/CommandPalette.tsx`**:
  - Currently renders a separate **usage banner box** above the suggestion list (`activeCommandDef.usage` + `activeCommandDef.description`) and a `Suggestions (Tab to complete)` list.
  - Lacks inline ghost text inside the input, inline command-name completion (`ve` after `/mo`), `ArrowRight` acceptance at end-of-input, `Backspace` on an empty argument returning to the previous argument, mobile "Accept" bar above `visualViewport`, and inline validation error state.
- **`tests/command-palette.test.ts`, `e2e/command-palette.spec.ts`, `e2e/qa-a11y-responsive.spec.ts`**:
  - Unit tests cover `parseSlashCommand`, `parseSearchQuery`, `COMMAND_REGISTRY`, shortcuts, scoped search, and `POST /api/commands/execute`.
  - E2E tests cover opening/closing, `/help`, `/theme`, `/new`, `/filter`, `/settings`, `/logout`.
  - `@axe-core/playwright` (`^4.14.0`) is already installed in `package.json`.

### Before Screenshots
Captured in command mode (`/move `) at `1440×900` and `390×844` in both light and dark themes:
- `docs/screenshots/slash-hints/before-desktop-light.png`
- `docs/screenshots/slash-hints/before-desktop-dark.png`
- `docs/screenshots/slash-hints/before-mobile-light.png`
- `docs/screenshots/slash-hints/before-mobile-dark.png`

### After Screenshots
Captured by `e2e/slash-hints.spec.ts` in command mode (`/move `) at `1440×900` and `390×844` in both light and dark themes:
- `docs/screenshots/slash-hints/after-desktop-light.png`
- `docs/screenshots/slash-hints/after-desktop-dark.png`
- `docs/screenshots/slash-hints/after-mobile-light.png`
- `docs/screenshots/slash-hints/after-mobile-dark.png`

---

## 2. What Will Be Replaced
- Remove the separate command usage/chip box inside `CommandPalette.tsx` (`activeCommandDef.usage` card above suggestions).
- Replace it with:
  1. **Inline Discord-style ghost hints** directly inside `CommandInput` (using typographic angle brackets `‹name›` for required args, `[name]` for optional args, `[key:type]` for optional keyed args, and `↵ Run` when ready).
  2. **Compact active-argument suggestion list** below the input, headed by a one-line description of the active argument (`"column: Target column name"`).
  3. **Right-edge `Tab` keycap hint** (shown only when a completion or suggestion can be accepted) and a mobile **Accept** row positioned above the on-screen keyboard (`visualViewport`).
  4. **Single-line validation error** below the input (with a subtle underline on the offending argument, keeping the ghost hint visible).

---

## 3. Planned Approach (Presentation & Input Behavior Only)
1. **Registry Display Metadata (`src/lib/commands/registry.ts`)**:
   - Add `label`, `typeName`, `required`, and `description` on positional `args` and optional `options: CommandOptionSpec[]` (e.g. `priority:level`, `assignee:@user`, `label:tag`, `column:col`, `wip:number`) without changing permissions, execution modes, or APIs.
2. **Parser Enhancements (`src/lib/commands/parser.ts`)**:
   - Enhance `parseSlashCommand` to return `activeState`:
     - `mode`: `"command_name" | "argument"`
     - `activeArgIndex`, `activeKeyedOption`, `activeToken`, `completedPositionalCount`, `usedOptionKeys`
     - `unknownKey` (with Levenshtein closest option suggestion), `duplicateKeys`, `overlongValue`, and offending token span.
   - Support `key:value` optional arguments in any order alongside `--flag value` compatibility for `POST /api/commands/execute`.
   - Add a pure schema-driven ghost-hint builder `buildSlashGhostHint(def, parsed)` so every registered command automatically gets accurate ghost segments (`activeSegment`, `remainingSegments`, `readyToRun`).
3. **Ghost Input Layer (`src/components/ui/command.tsx`)**:
   - Single-line `<CommandPrimitive.Input>` + absolutely positioned `aria-hidden` `pointer-events-none` ghost layer inside the same relative wrapper.
   - Hidden mirror `<span>` with identical font, size, weight, letter-spacing, and padding; measured via `ResizeObserver`, `document.fonts.ready`, theme/zoom/value changes, batched with `requestAnimationFrame`.
   - Synced with `input.scrollLeft`, supporting RTL (`dir="rtl"` / computed direction), truncating ghost with ellipsis when it overflows, and hiding when caret is mid-text, text is selected, IME composition is active, or typed text alone overflows.
   - Accessibility: `aria-describedby` pointing to a visually hidden description + `aria-live="polite"` region announcing active argument changes.
   - 80ms fade-in (`motion-reduce:transition-none`), `forced-colors` and `prefers-contrast` support.
4. **Palette UX (`src/components/CommandPalette.tsx`)**:
   - Inline command-name completion (`/mo` → ghost `ve` + first arg hint; `Tab` or `→` at end accepts).
   - `Tab` accepts highlighted suggestion and advances; `Enter` accepts incomplete suggestion or runs command when ready; `↑`/`↓` navigate suggestions; `Backspace` on an empty argument returns to the previous argument and restores its hint.
   - Touch/mobile: `visualViewport`-aware Accept bar with ≥44×44px tap targets.
5. **Documentation & Verification**:
   - Update `docs/COMMAND_PALETTE.md` and `docs/SLASH_HINTS_PLAN.md` (with after screenshots).
   - Add comprehensive unit tests (parser, schema-driven ghost hints for every command) and Playwright tests (alignment at 100%/200% zoom, light/dark, caret/selection/IME/scroll/RTL/emoji/CJK, Tab/ArrowRight/Backspace/Enter, clipboard/value/a11y, mobile 390×844 & 320×568, axe-core, forced-colors, prefers-contrast, visual regression baselines) and run the full test-fix loop.
