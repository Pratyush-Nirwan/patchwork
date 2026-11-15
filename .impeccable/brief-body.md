# Surface Brief: Patchwork Workspace (`src/app/page.tsx`)

Mode: Operate

## Audience & Task
Developers, team leads, and org admins triaging, moving, searching, and inspecting engineering tickets across Organizations, Teams, Projects, and Boards in real time.

## Direction contract

THESIS: Patchwork treats multi-team engineering triage as a precision dispatch schedule rather than a bloated card wall, pairing a dense Jira-grade workspace shell with tabular ticket telemetry, instant SSE state indicators, and a split-screen detail inspector.

OWN-WORLD: Architectural blueprint and Swiss railway dispatch timetable register — warm drafting-paper slate in light mode (`#F6F5F2` ground, `#141619` ink, `#1E242B` deep cobalt-slate navigation rail, `#D94E1F` signal vermilion accent) and low-glare control-room slate in dark mode (`#0D1014` ground, `#13181E` elevated surface, `#EBF0F5` ink, `#F05A28` signal vermilion), crisp 1px structural hairlines (`#D8D6D0` / `#222933`), Geist Sans + JetBrains Mono tabular numerals.

STORY: An engineer lands in their active Org/Team/Project/Board workspace, immediately scans WIP capacity gauges and priority-coded ticket rows/cards, moves work across columns with live SSE sync, searches across tickets/comments/attachment contents via `Cmd/Ctrl+K`, and inspects markdown descriptions, GitHub/GitLab PR statuses, attachments, and activity logs in the slide-over detail panel.

FIRST VIEWPORT: Fixed 240px dark slate left navigation rail (Org switcher, Team/Project/Board hierarchy tree, role badge, theme toggle), top 48px breadcrumb and global search bar (`/` or `Cmd+K` trigger, live SSE pulse indicator, column manager), and full-height horizontal Kanban board canvas with custom columns, WIP limit progress bars, compact ticket cards (monospace key, priority badge, title, labels, comment/attachment counts, assignee pill), and a 520px right-hand ticket detail inspector sheet when a ticket is selected.

FORM: Candidate 7 — Precision Engineering Dispatch Ledger (raised by `design-annual-s-plate-section` 1px structural hairlines and tabular mono metadata tokens); seed key `c5bdc2a9`.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

