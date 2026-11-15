---
name: Patchwork
description: Self-hosted multi-team engineering ticketing & Kanban dispatch platform
colors:
  signal-vermilion: "#C84317"
  signal-vermilion-deep: "#AF3810"
  signal-vermilion-soft: "#FCECE6"
  drafting-paper: "#F6F5F2"
  card-sheet: "#FFFFFF"
  muted-stone: "#ECEAE4"
  dispatch-rail: "#141920"
  dispatch-rail-elevated: "#1D242E"
  carbon-ink: "#141619"
  slate-secondary: "#434B56"
  hairline-rule: "#D8D6D0"
  priority-urgent: "#B91C1C"
  priority-high: "#C2410C"
  priority-medium: "#1D4ED8"
  priority-low: "#0F766E"
  status-merged: "#15803D"
typography:
  display:
    fontFamily: "Söhne, Neue Haas Grotesk Text, Atkinson Hyperlegible, -apple-system, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Söhne, Neue Haas Grotesk Text, Atkinson Hyperlegible, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Söhne, Neue Haas Grotesk Text, Atkinson Hyperlegible, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "Söhne, Neue Haas Grotesk Text, Atkinson Hyperlegible, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Berkeley Mono, Commit Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.04em"
  micro:
    fontFamily: "Berkeley Mono, Commit Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.04em"
rounded:
  xs: "2px"
  sm: "3px"
  md: "4px"
  lg: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "{colors.signal-vermilion}"
    textColor: "{colors.card-sheet}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-primary-hover:
    backgroundColor: "{colors.signal-vermilion-deep}"
  card-ticket:
    backgroundColor: "{colors.drafting-paper}"
    textColor: "{colors.carbon-ink}"
    rounded: "{rounded.md}"
    padding: "10px"
---

# Design System: Patchwork

## Overview

**Creative North Star: "Precision Engineering Dispatch Ledger"**

Patchwork treats multi-team issue tracking as a high-density operational dispatch board rather than a decorative marketing wall. Inspired by Swiss railway timetables and architectural drafting sheets, every pixel serves scannability: a dark cobalt-slate left navigation rail anchors the `Org -> Team -> Project -> Board` hierarchy, while the warm drafting-paper canvas (`#F6F5F2` in light mode, `#0D1014` in dark mode) holds crisp 1px-bordered columns, tabular ticket keys, and a slide-over detail inspector.

**Key Characteristics:**
- High-signal operational density with 12px (`0.75rem`) base workspace copy and `tabular-nums` alignment on all ticket keys, counts, and WIP gauges.
- Tonal architectural contrast pairing a deep slate navigation rail (`#141920`) with a low-glare warm stone workspace ground (`#F6F5F2`).
- Precision WIP capacity bars integrated directly into Kanban column headers to surface bottlenecks before cards overflow.

## Colors

The palette pairs warm drafting-paper neutrals and deep control-room slate with a decisive Signal Vermilion primary action color and semantic priority badges.

### Primary
- **Signal Vermilion** (`#C84317` light / `#F05A28` dark): Used for primary actions (`New Ticket`, `Register`, active board indicator), ticket key callouts, and focus rings.
- **Signal Vermilion Deep** (`#AF3810`): Active and hover state for primary dispatch buttons.
- **Signal Vermilion Soft** (`#FCECE6`): Highlight background for full-text search `<mark>` snippets and active ticket key pills.

### Secondary
- **Priority Urgent** (`#B91C1C`), **Priority High** (`#C2410C`), **Priority Medium** (`#1D4ED8`), **Priority Low** (`#0F766E`): Semantic priority andWIP threshold indicators.
- **Status Merged** (`#15803D`): GitHub/GitLab link status badge and live SSE pulse indicator.

### Neutral
- **Drafting Paper** (`#F6F5F2` light / `#0D1014` dark): Primary board canvas ground.
- **Card Sheet** (`#FFFFFF` light / `#13181E` dark): Column containers, modals, and slide-over ticket inspector.
- **Dispatch Rail** (`#141920` light / `#090C10` dark): Fixed left hierarchy navigation rail.
- **Carbon Ink** (`#141619` light / `#EBF0F5` dark): Primary body and heading text.
- **Slate Secondary** (`#434B56` light / `#A6B2C0` dark): Secondary metadata, breadcrumbs, and timestamps (≥4.5:1 contrast).
- **Hairline Rule** (`#D8D6D0` light / `#222A35` dark): 1px structural dividers across columns, cards, and headers.

### Named Rules
**The Structural Hairline Rule.** Every workspace boundary—navigation rail, top breadcrumb bar, Kanban column, and ticket card—is separated by a 1px structural border (`#D8D6D0` / `#222A35`) rather than heavy drop shadows.

## Typography

**Display & UI Font:** Söhne, Neue Haas Grotesk Text, Atkinson Hyperlegible (`-apple-system`, `sans-serif`)
**Label & Monospace Font:** Berkeley Mono, Commit Mono (`ui-monospace`, `monospace`)

**Character:** Clean neo-grotesque prose for ticket titles and markdown discussions paired with high-legibility tabular monospace for ticket keys (`TELE-1`), project prefixes, role badges, and WIP ratios.

### Hierarchy
- **Display** (`600`, `2.25rem`, `1.15` line-height): Auth split-screen hero statement.
- **Headline** (`600`, `1.125rem`, `1.3` line-height): Modal and inspector titles.
- **Title** (`600`, `0.875rem`, `1.35` line-height): Column headers and section headings.
- **Body** (`400`, `0.75rem`, `1.5` line-height, `65–70ch` max measure): Ticket descriptions, comments, and activity entries.
- **Label** (`600`, `0.6875rem`, `0.04em` tracking, uppercase mono): Ticket keys, priority pills, and RBAC role badges.

### Named Rules
**The Tabular Telemetry Rule.** Every ticket key, WIP ratio (`2/4`), attachment byte size, and timestamp must enforce `font-variant-numeric: tabular-nums` so vertical columns scan without jitter.

## Layout

Patchwork uses a full-viewport application shell (`100vw × 100vh`, `overflow-hidden`) divided into three zones:
1. **Left Navigation Rail (`256px` fixed width, collapsible via `[`)**: Holds Organization switcher, Team list, Project & Board hierarchy tree, user profile, theme toggle, and keyboard shortcut reference.
2. **Top Dispatch Bar (`48px` height)**: Holds sidebar toggle, `Org / Team / Project / Board` breadcrumb trail, global PostgreSQL GIN full-text search bar (`max-w-md`), live SSE status badge, and primary board actions.
3. **Kanban Canvas & Slide-Over Inspector**: Horizontal scrolling flex canvas of `304px` (`w-76`) columns with a `576px` (`max-w-xl`) right-hand slide-over detail sheet when a ticket is inspected.

## Elevation & Depth

Surfaces are flat by default and rely on tonal layering (`--pw-bg` vs `--pw-surface` vs `--pw-surface-muted`) and 1px structural borders. Elevated overlays (search results dropdown, modals, and the slide-over ticket inspector) use a single soft directional shadow.

### Shadow Vocabulary
- **Overlay Elevation** (`box-shadow: 0 6px 20px -4px rgba(20, 22, 25, 0.08), 0 2px 6px -1px rgba(20, 22, 25, 0.04)`): Applied exclusively to floating dialogs, search popovers, and the slide-over inspector panel.

## Shapes

Sharp, technical geometry (`4px` border radius on buttons, inputs, cards, and badges) reinforces the precision engineering ledger aesthetic.

## Components

### Buttons
- **Shape:** Crisp 4px radius (`rounded`).
- **Primary:** Signal Vermilion (`#C84317`) background, white (`#FFFFFF`) 12px semibold label, `6px 12px` padding, darkening to `#AF3810` on hover.
- **Secondary:** `1px solid #D8D6D0` border over `#F6F5F2` background with `#141619` text.

### Cards / Containers
- **Corner Style:** 4px radius (`rounded`).
- **Background:** `#F6F5F2` ticket cards nested inside `#FFFFFF` column containers (inverting to `#0D1014` inside `#13181E` in dark mode).
- **Border:** `1px solid var(--pw-border)`, shifting to `var(--pw-accent)` when selected in the detail inspector.
- **Internal Padding:** Compact `10px` (`p-2.5`) card padding.

### Inputs / Fields
- **Style:** `1px solid var(--pw-border)` stroke, `var(--pw-bg)` background, 4px radius, `12px` text.
- **Focus:** `2px solid var(--pw-accent)` outline with `2px` offset.

### Navigation
- **Left Rail:** Deep cobalt-slate (`#141920`) with `#EAEEF3` text, `#9AA6B5` muted labels, and `#C84317` active board highlight.

### WIP Capacity Gauge (Signature Component)
- **Behavior:** A 4px-tall horizontal progress track embedded in the header of any Kanban column with a `wipLimit`. Fills proportionally in Signal Vermilion (`--pw-accent`) and shifts to Urgent Crimson (`--pw-urgent`) with a red column border when ticket count exceeds the column's WIP limit.

## Do's and Don'ts

### Do:
- **Do** keep ticket cards compact (`p-2.5`) with monospace keys (`TELE-1`) and priority badges on the top row.
- **Do** use `tabular-nums` on all ticket numbers, WIP counters, and file sizes.
- **Do** maintain ≥4.5:1 contrast on all secondary slate labels in both light and dark modes.

### Don't:
- **Don't** place uppercase eyebrow/kicker labels above section headings.
- **Don't** use decorative glassmorphism, gradient text, or >1px colored side borders on ticket cards.
- **Don't** use emoji or raw Unicode symbols in place of SVG icons.
