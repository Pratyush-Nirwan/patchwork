"use client";

import React,{ useCallback,useEffect,useMemo,useRef,useState } from "react";
import {
AlertTriangle,BookOpen,Check,FileText,FolderKanban,
Hash,
HelpCircle,
LayoutGrid,MessageSquare,Tag,
Terminal,
Ticket,User,
Users
} from "lucide-react";
import {
Command,
CommandDialog,
CommandEmpty,
CommandGroup,
CommandInput,
CommandItem,
CommandList,
CommandSeparator,
CommandShortcut,
type CommandGhostConfig,
} from "@/components/ui/command";
import { SearchPaletteSkeleton } from "@/components/skeletons/SearchPaletteSkeleton";
import { RouteProgressBar } from "@/components/ui/motion";
import {
COMMAND_REGISTRY,
filterCommandsByQuery,
findCommandDefinition,
formatUsage,
isRoleAllowedForCommand,
type CommandArgAutocomplete,
type CommandDefinition,
} from "@/lib/commands/registry";
import {
buildCommandNameGhostHint,
buildSlashGhostHint,
parseSlashCommand,
type CommandTokenSpan
} from "@/lib/commands/parser";
import {
loadCommandHistory,
recordCommandHistory,
} from "@/lib/commands/history";
import { formatShortcut,type ShortcutMap } from "@/lib/shortcuts";
import type { EffectiveRole } from "@/db/schema";
import type { ScopedSearchGroups,SearchResultItem } from "@/lib/search";

import {
clearRecentPaletteItems,
loadRecentPaletteItems,
recordRecentPaletteItem,
type RecentPaletteItem,
} from "./command-palette/palette-history";
import { getCommandIcon } from "./command-palette/palette-icons";
import { validateActiveArgument } from "./command-palette/palette-validation";
export { clearRecentPaletteItems };


export interface BoardFilterState {
  priority?: string;
  assignee?: string;
  label?: string;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialQuery?: string;
  helpMode: boolean;
  onHelpModeChange: (help: boolean) => void;
  user: { id: string; name: string; email: string };
  userRole: EffectiveRole;
  orgId?: string;
  teamId?: string;
  boardId?: string;
  boards: Array<{
    id: string;
    name: string;
    projectKey: string;
    projectName: string;
    teamId: string;
    teamName: string;
  }>;
  columns: Array<{ id: string; name: string }>;
  tickets: Array<{
    id: string;
    key: string;
    title: string;
    labels: string[];
    priority: string;
    columnId?: string;
    assigneeId?: string | null;
    assigneeName?: string | null;
    dueDate?: string | null;
  }>;
  members: Array<{ id: string; name: string; email: string }>;
  shortcuts: ShortcutMap;
  apiFetch: (url: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  onSelectTicket: (boardId: string, ticketId: string) => void;
  onSelectBoard: (boardId: string) => void;
  onSetViewMode: (mode: "kanban" | "calendar") => void;
  onSetBoardFilter: (filter: BoardFilterState | null) => void;
  onToggleSidebar: () => void;
  onSetTheme: (mode: "dark" | "light" | "toggle") => void;
  onOpenMembers: () => void;
  onOpenSettings: () => void;
  onOpenSystem: () => void;
  onLogout: () => void;
  onRefreshBoard: () => Promise<void> | void;
  currentTheme?: "light" | "dark";
  onShowSnackbar?: (opts: {
    message: string;
    actionLabel?: string;
    onAction?: () => void | Promise<void>;
  }) => void;
}

interface ArgSuggestion {
  value: string;
  label: string;
  hint?: string;
  applyToken: string;
  isOptionKey?: boolean;
  replaceSpan?: CommandTokenSpan;
}

const DOCS_TOPICS: Array<{ slug: string; label: string; path: string }> = [
  { slug: "quick-start", label: "Quick Start", path: "/documentation/getting-started/quick-start/" },
  { slug: "installation", label: "Installation", path: "/documentation/getting-started/installation/" },
  { slug: "setup-wizard", label: "Setup Wizard", path: "/documentation/getting-started/setup-wizard/" },
  { slug: "domain-and-https", label: "Domain & HTTPS", path: "/documentation/getting-started/domain-and-https/" },
  { slug: "command-palette", label: "Command Palette & Slash Commands", path: "/documentation/user-guide/command-palette/" },
  { slug: "shortcuts", label: "Shortcuts & Themes", path: "/documentation/user-guide/shortcuts-and-themes/" },
  { slug: "roles-and-permissions", label: "Roles & Permissions", path: "/documentation/reference/roles-and-permissions/" },
  { slug: "configuration", label: "Configuration & Settings", path: "/documentation/reference/configuration/" },
  { slug: "troubleshooting", label: "Troubleshooting & FAQ", path: "/documentation/operations/troubleshooting/" },
];

export function CommandPalette({
  open,
  onOpenChange,
  initialQuery = "",
  helpMode,
  onHelpModeChange,
  user,
  userRole,
  orgId,
  teamId,
  boardId,
  boards,
  columns,
  tickets,
  members,
  shortcuts,
  apiFetch,
  onSelectTicket,
  onSelectBoard,
  onSetViewMode,
  onSetBoardFilter,
  onToggleSidebar,
  onSetTheme,
  onOpenMembers,
  onOpenSettings,
  onOpenSystem,
  onLogout,
  onRefreshBoard,
  currentTheme = "light",
  onShowSnackbar,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [recentItems, setRecentItems] = useState<RecentPaletteItem[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyDraftRef = useRef("");
  const [helpDetailCmd, setHelpDetailCmd] = useState<string | null>(null);
  const [searchGroups, setSearchGroups] = useState<ScopedSearchGroups | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [selectedItemValue, setSelectedItemValue] = useState("");
  const userNavigatedRef = useRef(false);
  const lastPointerPosRef = useRef<{ x: number; y: number } | null>(null);
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [feedback, setFeedback] = useState<{ type: "ok" | "error" | "info"; text: string } | null>(
    null
  );
  const [pendingConfirm, setPendingConfirm] = useState<{
    def: CommandDefinition;
    rawCommand: string;
    positional: string[];
    flags: Record<string, string>;
    rawArgs: string;
    ticketContext?: {
      key: string;
      title: string;
      boardName: string;
      assigneeName: string;
      columnName: string;
    };
  } | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelConfirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      if (initialQuery) {
        setQuery(initialQuery);
      }
      setRecentItems(loadRecentPaletteItems(user.id));
      setCommandHistory(loadCommandHistory(user.id, userRole));
      setHistoryIndex(-1);
      historyDraftRef.current = "";
      setHelpDetailCmd(null);
      setFeedback(null);
      setPendingConfirm(null);
      setSelectedItemValue("");
      userNavigatedRef.current = false;
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          if (initialQuery) {
            el.setSelectionRange(initialQuery.length, initialQuery.length);
          }
        }
      });
    } else {
      setQuery("");
      setSearchGroups(null);
      setSearchResults([]);
      setHelpDetailCmd(null);
      setFeedback(null);
      setPendingConfirm(null);
      setHistoryIndex(-1);
      historyDraftRef.current = "";
      setSelectedItemValue("");
      userNavigatedRef.current = false;
    }
  }, [open, initialQuery, user.id, userRole]);

  useEffect(() => {
    if (pendingConfirm) {
      requestAnimationFrame(() => cancelConfirmRef.current?.focus());
    }
  }, [pendingConfirm]);

  // Track visualViewport for mobile on-screen keyboard positioning
  useEffect(() => {
    if (!open || typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const updateOffset = () => {
      const offset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      setKeyboardOffset(offset);
    };
    updateOffset();
    vv.addEventListener("resize", updateOffset);
    vv.addEventListener("scroll", updateOffset);
    return () => {
      vv.removeEventListener("resize", updateOffset);
      vv.removeEventListener("scroll", updateOffset);
    };
  }, [open]);

  const baseParsed = useMemo(() => parseSlashCommand(query), [query]);
  const isSlashMode = baseParsed.isCommand;

  const activeCommandDef = useMemo(() => {
    if (!baseParsed.isCommand || !baseParsed.inArgumentMode) return undefined;
    return findCommandDefinition(baseParsed.commandName);
  }, [baseParsed]);

  const parsedSlash = useMemo(
    () => parseSlashCommand(query, activeCommandDef),
    [query, activeCommandDef]
  );

  // Debounced server search when not in slash mode and not in help mode
  useEffect(() => {
    if (!open || helpMode || isSlashMode) {
      setIsSearching(false);
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchGroups(null);
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const params = new URLSearchParams({ q: trimmed });
        if (orgId) params.set("orgId", orgId);
        const res = await fetch(`/api/search?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          setIsSearching(false);
          return;
        }
        const data = (await res.json()) as {
          results?: SearchResultItem[];
          groups?: ScopedSearchGroups;
        };
        setSearchResults(Array.isArray(data.results) ? data.results : []);
        setSearchGroups(data.groups || null);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setSearchResults([]);
          setSearchGroups(null);
        }
      } finally {
        setIsSearching(false);
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, helpMode, isSlashMode, query, orgId]);

  const matchingCommands = useMemo(() => {
    if (!parsedSlash.isCommand) {
      return filterCommandsByQuery("", userRole).slice(0, 6);
    }
    if (activeCommandDef) return [];
    return filterCommandsByQuery(parsedSlash.commandName, userRole);
  }, [parsedSlash, activeCommandDef, userRole]);

  const buildSuggestionsForKind = useCallback(
    (kind: CommandArgAutocomplete, currentToken: string): ArgSuggestion[] => {
      const quoteIfNeeded = (val: string) => (/\s/.test(val) ? `"${val}"` : val);
      const lower = currentToken.toLowerCase();

      switch (kind) {
        case "ticket":
          return tickets
            .filter(
              (t) =>
                !lower ||
                t.key.toLowerCase().includes(lower) ||
                t.title.toLowerCase().includes(lower)
            )
            .slice(0, 8)
            .map((t) => ({
              value: t.key,
              label: t.key,
              hint: t.title,
              applyToken: t.key,
            }));

        case "column":
          return columns
            .filter((c) => !lower || c.name.toLowerCase().includes(lower))
            .map((c) => ({
              value: c.name,
              label: c.name,
              applyToken: quoteIfNeeded(c.name),
            }));

        case "member": {
          const base: ArgSuggestion[] = [
            { value: "me", label: "me", hint: user.name, applyToken: "me" },
            {
              value: "unassigned",
              label: "unassigned",
              hint: "Clear assignee",
              applyToken: "unassigned",
            },
            ...members.map((m) => ({
              value: m.email,
              label: m.name,
              hint: m.email,
              applyToken: m.email,
            })),
          ];
          return base.filter(
            (item) =>
              !lower ||
              item.label.toLowerCase().includes(lower) ||
              (item.hint || "").toLowerCase().includes(lower)
          );
        }

        case "priority":
          return ["urgent", "high", "medium", "low"]
            .filter((p) => !lower || p.includes(lower))
            .map((p) => ({ value: p, label: p, applyToken: p }));

        case "label": {
          const uniqueLabels = Array.from(
            new Set(tickets.flatMap((t) => t.labels || []))
          ).sort();
          return uniqueLabels
            .filter((l) => !lower || l.toLowerCase().includes(lower.replace(/^[+-]/, "")))
            .slice(0, 8)
            .map((l) => ({
              value: `+${l}`,
              label: `+${l}`,
              hint: "Add label",
              applyToken: `+${l}`,
            }));
        }

        case "due":
          return [
            { value: "today", label: "today", hint: "Set due date to today", applyToken: "today" },
            {
              value: "tomorrow",
              label: "tomorrow",
              hint: "Set due date to tomorrow",
              applyToken: "tomorrow",
            },
            { value: "none", label: "none", hint: "Clear due date", applyToken: "none" },
          ].filter((d) => !lower || d.value.includes(lower));

        case "board":
          return boards
            .filter(
              (b) =>
                !lower ||
                b.name.toLowerCase().includes(lower) ||
                b.projectKey.toLowerCase().includes(lower) ||
                b.teamName.toLowerCase().includes(lower)
            )
            .slice(0, 8)
            .map((b) => ({
              value: b.id,
              label: `${b.projectKey} · ${b.name}`,
              hint: b.teamName,
              applyToken: quoteIfNeeded(b.name),
            }));

        case "view":
          return ["kanban", "calendar"]
            .filter((v) => !lower || v.includes(lower))
            .map((v) => ({ value: v, label: v, applyToken: v }));

        case "theme":
          return ["dark", "light", "toggle"]
            .filter((t) => !lower || t.includes(lower))
            .map((t) => ({ value: t, label: t, applyToken: t }));

        case "filter":
          return [
            { value: "priority:urgent", label: "priority:urgent", applyToken: "priority:urgent" },
            { value: "priority:high", label: "priority:high", applyToken: "priority:high" },
            { value: "assignee:me", label: "assignee:me", applyToken: "assignee:me" },
            { value: "clear", label: "clear", hint: "Reset board filters", applyToken: "clear" },
          ].filter((f) => !lower || f.value.includes(lower));

        case "command":
          return filterCommandsByQuery(lower, userRole)
            .slice(0, 8)
            .map((c) => ({
              value: c.name,
              label: `/${c.name}`,
              hint: c.description,
              applyToken: c.name,
            }));

        case "docs":
          return DOCS_TOPICS.filter(
            (t) =>
              !lower ||
              t.slug.includes(lower) ||
              t.label.toLowerCase().includes(lower)
          ).map((t) => ({
            value: t.slug,
            label: t.slug,
            hint: t.label,
            applyToken: t.slug,
          }));

        default:
          return [];
      }
    },
    [tickets, columns, members, user.name, boards, userRole]
  );

  const argSuggestions = useMemo((): ArgSuggestion[] => {
    if (!parsedSlash.isCommand || !activeCommandDef) return [];

    if (parsedSlash.activeOption) {
      return buildSuggestionsForKind(
        parsedSlash.activeOption.spec.autocomplete,
        parsedSlash.activeOption.value
      );
    }

    const argSpec =
      parsedSlash.activeArgIndex >= 0 && parsedSlash.activeArgIndex < activeCommandDef.args.length
        ? activeCommandDef.args[parsedSlash.activeArgIndex]
        : null;

    if (argSpec && !argSpec.greedyText) {
      return buildSuggestionsForKind(argSpec.autocomplete, parsedSlash.activeArgToken);
    }

    const options = activeCommandDef.options || [];
    if (options.length === 0) return [];
    const unused = options.filter((o) => !parsedSlash.usedOptionKeys.includes(o.key));
    if (unused.length === 0) return [];

    const formatOptionSuggestion = (
      o: (typeof unused)[number],
      replaceSpan?: CommandTokenSpan
    ): ArgSuggestion => ({
      value: `opt-${o.key}`,
      label: `${o.key}:`,
      hint: `${o.description}${o.exampleValue ? ` (e.g. ${o.key}:${o.exampleValue})` : ""}`,
      applyToken: `${o.key}:`,
      isOptionKey: true,
      replaceSpan,
    });

    if (argSpec?.greedyText) {
      if (parsedSlash.positional.length === 0) return [];
      if (parsedSlash.hasTrailingSpace) {
        return unused.map((o) => formatOptionSuggestion(o));
      }
      const lastSpan = parsedSlash.allArgSpans[parsedSlash.allArgSpans.length - 1];
      if (lastSpan && !lastSpan.quoted && !lastSpan.value.includes(":")) {
        const prefix = lastSpan.value.toLowerCase();
        const matches = unused.filter((o) => o.key.startsWith(prefix));
        if (matches.length > 0) {
          return matches.map((o) => formatOptionSuggestion(o, lastSpan));
        }
      }
      return [];
    }

    // Suggest unused optional keys when past positional args
    const tok = parsedSlash.activeArgToken.toLowerCase();
    return unused
      .filter((o) => !tok || o.key.startsWith(tok))
      .map((o) => formatOptionSuggestion(o));
  }, [parsedSlash, activeCommandDef, buildSuggestionsForKind]);

  const isShowingOptionKeys = argSuggestions.length > 0 && Boolean(argSuggestions[0]?.isOptionKey);

  const selectableValues = useMemo(() => {
    if (!isSlashMode || helpMode) return [] as string[];
    if (activeCommandDef) {
      return argSuggestions.map((s) => `arg-${s.value}`);
    }
    const vals: string[] = [];
    if (parsedSlash.isCommand && parsedSlash.commandName === "") {
      commandHistory.slice(0, 5).forEach((_, idx) => vals.push(`hist-${idx}`));
    }
    matchingCommands.forEach((cmd) => vals.push(`cmd-${cmd.name}`));
    return vals;
  }, [isSlashMode, helpMode, activeCommandDef, argSuggestions, parsedSlash, commandHistory, matchingCommands]);

  useEffect(() => {
    if (!isSlashMode || helpMode) {
      setSelectedItemValue("");
      return;
    }
    if (isShowingOptionKeys) {
      if (!userNavigatedRef.current) {
        setSelectedItemValue("");
      } else if (selectedItemValue && !selectableValues.includes(selectedItemValue)) {
        setSelectedItemValue("");
      }
      return;
    }
    if (!userNavigatedRef.current || !selectableValues.includes(selectedItemValue)) {
      setSelectedItemValue(selectableValues[0] || "");
    }
  }, [isSlashMode, helpMode, isShowingOptionKeys, selectableValues, selectedItemValue]);

  const validationError = useMemo(() => {
    if (!parsedSlash.isCommand || !activeCommandDef) return null;
    return validateActiveArgument(activeCommandDef, parsedSlash);
  }, [parsedSlash, activeCommandDef]);

  const ghostConfig = useMemo((): CommandGhostConfig | null => {
    if (!isSlashMode || !parsedSlash.isCommand || helpMode) return null;

    // 1. Command name completion mode (e.g. /mo -> ve ticket column)
    if (!parsedSlash.inArgumentMode) {
      if (parsedSlash.commandName.length === 0 || matchingCommands.length === 0) return null;
      const best = matchingCommands[0];
      const { completion, remainingArgs, remainingItems } = buildCommandNameGhostHint(
        parsedSlash.commandName,
        best
      );
      if (!completion && remainingArgs.length === 0) return null;
      return {
        activeText: completion,
        activeIsPill: false,
        activeRequired: false,
        remainingText: remainingArgs.join(" "),
        remainingItems,
        needsLeadingSpace: completion.length === 0 && remainingItems.length > 0,
        readyToRun: false,
        showTabHint: completion.length > 0,
        ariaDescription: `Command completion: /${best.name} — ${best.description}`,
        liveAnnouncement: `Command /${best.name}`,
      };
    }

    // 2. Argument mode
    if (!activeCommandDef) return null;
    const hint = buildSlashGhostHint(activeCommandDef, parsedSlash);
    const activeSpec = hint.activeOptionSpec || hint.activeArgSpec;
    const activeDesc = hint.activeOptionSpec
      ? `${hint.activeOptionSpec.key}: ${hint.activeOptionSpec.description}`
      : hint.activeArgSpec
      ? `Argument ${hint.activeArgPosition} of ${hint.totalArgs}: ${hint.activeArgSpec.label}, ${
          hint.activeArgSpec.required ? "required" : "optional"
        } — ${hint.activeArgSpec.description}`
      : "";

    // Inline autocomplete suffix when user is typing a definite-option value (e.g. column, priority, view, theme)
    let inlineCompletion = "";
    const typedRaw = parsedSlash.activeOption
      ? parsedSlash.activeOption.value
      : !parsedSlash.hasTrailingSpace
      ? parsedSlash.activeArgToken
      : "";
    const typedPrefix = typedRaw.replace(/^["']/, "");
    if (!hint.activeSegment && typedPrefix.length > 0 && argSuggestions.length > 0) {
      const top = argSuggestions[0];
      const candidate = (top.applyToken || top.label).replace(/^["']|["']$/g, "");
      if (
        candidate.length > typedPrefix.length &&
        candidate.toLowerCase().startsWith(typedPrefix.toLowerCase())
      ) {
        inlineCompletion = candidate.slice(typedPrefix.length);
      }
    }

    const activeText = inlineCompletion || hint.activeSegment;
    const activeIsPill = Boolean(hint.activeSegment) && !inlineCompletion;

    return {
      activeText,
      activeIsPill,
      activeRequired: activeIsPill ? hint.activeRequired : false,
      remainingText: hint.remainingSegments.join(" "),
      remainingItems: hint.remainingItems,
      needsLeadingSpace: hint.needsLeadingSpace,
      needsColonGap: hint.needsColonGap,
      readyToRun: hint.readyToRun,
      showTabHint: argSuggestions.length > 0,
      ariaDescription: activeDesc,
      liveAnnouncement: activeSpec ? activeDesc : "",
      errorSpan: validationError?.span || null,
    };
  }, [
    isSlashMode,
    parsedSlash,
    helpMode,
    matchingCommands,
    activeCommandDef,
    argSuggestions,
    validationError,
  ]);

  const activeArgHeader = useMemo(() => {
    if (!parsedSlash.isCommand || !activeCommandDef) return null;
    if (parsedSlash.activeOption) {
      return `${parsedSlash.activeOption.spec.key}: ${parsedSlash.activeOption.spec.description}`;
    }
    if (isShowingOptionKeys) {
      return "Optional: pick an option, or press Enter to run";
    }
    const spec = activeCommandDef.args[parsedSlash.activeArgIndex];
    if (spec) {
      return `${spec.label}: ${spec.description}`;
    }
    if (activeCommandDef.options && activeCommandDef.options.length > 0) {
      return "Optional: pick an option, or press Enter to run";
    }
    return null;
  }, [parsedSlash, activeCommandDef, isShowingOptionKeys]);

  const applyArgCompletion = useCallback(
    (suggestion: ArgSuggestion) => {
      if (!parsedSlash.isCommand || !activeCommandDef) return;
      userNavigatedRef.current = false;

      if (parsedSlash.activeOption) {
        const span = parsedSlash.activeOption.tokenSpan;
        const before = query.slice(0, span.start);
        const after = `${parsedSlash.activeOption.key}:${suggestion.applyToken} `;
        setQuery(`${before}${after}`);
        inputRef.current?.focus();
        return;
      }

      if (suggestion.isOptionKey) {
        const base = suggestion.replaceSpan
          ? query.slice(0, suggestion.replaceSpan.start)
          : parsedSlash.hasTrailingSpace
          ? query
          : parsedSlash.activeArgSpan
          ? query.slice(0, parsedSlash.activeArgSpan.start)
          : `${query} `;
        setQuery(`${base}${suggestion.applyToken}`);
        inputRef.current?.focus();
        return;
      }

      if (parsedSlash.activeArgSpan) {
        const before = query.slice(0, parsedSlash.activeArgSpan.start);
        setQuery(`${before}${suggestion.applyToken} `);
      } else {
        const base = query.endsWith(" ") ? query : `${query} `;
        setQuery(`${base}${suggestion.applyToken} `);
      }
      inputRef.current?.focus();
    },
    [parsedSlash, activeCommandDef, query]
  );

  const runServerCommand = useCallback(
    async (
      def: CommandDefinition,
      positional: string[],
      flags: Record<string, string>,
      rawArgs: string,
      rawInput: string,
      keepOpen = false
    ) => {
      setExecuting(true);
      setFeedback(null);
      const targetKey = (positional[0] || "").trim().toLowerCase();
      const prevTicket = targetKey
        ? tickets.find((t) => t.key.toLowerCase() === targetKey)
        : undefined;

      try {
        const res = await apiFetch("/api/commands/execute", {
          method: "POST",
          body: JSON.stringify({
            command: def.name,
            positional,
            flags,
            rawArgs,
            context: { orgId, teamId, boardId },
          }),
        });
        await onRefreshBoard();
        recordCommandHistory(user.id, rawInput, def);
        setCommandHistory(loadCommandHistory(user.id, userRole));

        const msg = typeof res.message === "string" ? res.message : `Executed /${def.name}`;
        if (keepOpen) {
          setQuery("");
          setFeedback({ type: "ok", text: msg });
          requestAnimationFrame(() => inputRef.current?.focus());
          return;
        }

        onOpenChange(false);

        let actionLabel: string | undefined;
        let onAction: (() => void | Promise<void>) | undefined;

        if (
          def.name === "new" &&
          typeof res.boardId === "string" &&
          typeof res.ticketId === "string"
        ) {
          const newBoardId = res.boardId;
          const newTicketId = res.ticketId;
          actionLabel = "Open";
          onAction = () => onSelectTicket(newBoardId, newTicketId);
        } else if (def.undoable && prevTicket) {
          actionLabel = "Undo";
          if (def.name === "move" && prevTicket.columnId) {
            const prevColId = prevTicket.columnId;
            onAction = async () => {
              await apiFetch(`/api/tickets/${prevTicket.id}/move`, {
                method: "PATCH",
                body: JSON.stringify({ targetColumnId: prevColId }),
              });
              await onRefreshBoard();
            };
          } else if (def.name === "assign") {
            const prevAssignee = prevTicket.assigneeId ?? null;
            onAction = async () => {
              await apiFetch(`/api/tickets/${prevTicket.id}`, {
                method: "PATCH",
                body: JSON.stringify({ assigneeId: prevAssignee }),
              });
              await onRefreshBoard();
            };
          } else if (def.name === "priority") {
            const prevPrio = prevTicket.priority;
            onAction = async () => {
              await apiFetch(`/api/tickets/${prevTicket.id}`, {
                method: "PATCH",
                body: JSON.stringify({ priority: prevPrio }),
              });
              await onRefreshBoard();
            };
          } else if (def.name === "label") {
            const prevLabels = [...prevTicket.labels];
            onAction = async () => {
              await apiFetch(`/api/tickets/${prevTicket.id}`, {
                method: "PATCH",
                body: JSON.stringify({ labels: prevLabels }),
              });
              await onRefreshBoard();
            };
          } else if (def.name === "due") {
            const prevDue = prevTicket.dueDate ?? null;
            onAction = async () => {
              await apiFetch(`/api/tickets/${prevTicket.id}`, {
                method: "PATCH",
                body: JSON.stringify({ dueDate: prevDue }),
              });
              await onRefreshBoard();
            };
          } else {
            actionLabel = undefined;
          }
        }

        onShowSnackbar?.({ message: msg, actionLabel, onAction });
      } catch (err) {
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Command failed",
        });
      } finally {
        setExecuting(false);
      }
    },
    [
      apiFetch,
      orgId,
      teamId,
      boardId,
      tickets,
      user.id,
      userRole,
      onRefreshBoard,
      onSelectTicket,
      onOpenChange,
      onShowSnackbar,
    ]
  );

  const executeSlashCommand = useCallback(
    async (rawInput: string, confirmed = false, keepOpen = false) => {
      const parsed0 = parseSlashCommand(rawInput);
      if (!parsed0.isCommand || !parsed0.commandName) return;

      const def = findCommandDefinition(parsed0.commandName);
      if (!def) {
        setFeedback({ type: "error", text: `Unknown command "/${parsed0.commandName}". Try /help.` });
        return;
      }
      const parsed = parseSlashCommand(rawInput, def);
      if (!parsed.isCommand) return;

      if (!isRoleAllowedForCommand(userRole, def.minRole)) {
        setFeedback({
          type: "error",
          text: `/${def.name} requires ${def.minRole} permissions.`,
        });
        return;
      }

      if (def.destructive && !confirmed) {
        if (def.name === "delete" || def.name === "archive") {
          const rawKey = (parsed.positional[0] || "").trim();
          if (!rawKey) {
            setFeedback({ type: "error", text: `Usage: ${formatUsage(def)}` });
            return;
          }
          try {
            let ticketIdToFetch = tickets.find(
              (t) => t.key.toLowerCase() === rawKey.toLowerCase()
            )?.id;

            if (!ticketIdToFetch) {
              const params = new URLSearchParams({ q: rawKey });
              if (orgId) params.set("orgId", orgId);
              const searchRes = await fetch(`/api/search?${params.toString()}`);
              if (searchRes.ok) {
                const searchData = (await searchRes.json()) as {
                  results?: SearchResultItem[];
                };
                const hit = searchData.results?.find(
                  (r) => r.ticketKey.toLowerCase() === rawKey.toLowerCase()
                );
                ticketIdToFetch = hit?.ticketId;
              }
            }

            if (!ticketIdToFetch) {
              setFeedback({ type: "error", text: "Ticket not found" });
              return;
            }

            const detailRes = await fetch(`/api/tickets/${ticketIdToFetch}`);
            if (!detailRes.ok) {
              setFeedback({ type: "error", text: "Ticket not found" });
              return;
            }
            const detail = (await detailRes.json()) as {
              ticket?: {
                key?: string;
                title?: string;
                assigneeName?: string | null;
              };
              board?: { name?: string };
              column?: { name?: string };
            };
            const t = detail.ticket;
            if (!t?.key) {
              setFeedback({ type: "error", text: "Ticket not found" });
              return;
            }

            setPendingConfirm({
              def,
              rawCommand: rawInput,
              positional: parsed.positional,
              flags: parsed.flags,
              rawArgs: parsed.rawArgs,
              ticketContext: {
                key: t.key,
                title: t.title || "",
                boardName: detail.board?.name || "Board",
                assigneeName: t.assigneeName || "Unassigned",
                columnName: detail.column?.name || "Unknown",
              },
            });
          } catch {
            setFeedback({ type: "error", text: "Ticket not found" });
          }
          return;
        }

        setPendingConfirm({
          def,
          rawCommand: rawInput,
          positional: parsed.positional,
          flags: parsed.flags,
          rawArgs: parsed.rawArgs,
        });
        return;
      }

      setPendingConfirm(null);

      if (def.execution === "server") {
        await runServerCommand(
          def,
          parsed.positional,
          parsed.flags,
          parsed.rawArgs,
          rawInput,
          keepOpen
        );
        return;
      }

      const finishClientFeedback = (msg: string, undoAction?: () => void | Promise<void>) => {
        recordCommandHistory(user.id, rawInput, def);
        setCommandHistory(loadCommandHistory(user.id, userRole));
        if (keepOpen) {
          setQuery("");
          setFeedback({ type: "ok", text: msg });
          requestAnimationFrame(() => inputRef.current?.focus());
          return;
        }
        onOpenChange(false);
        onShowSnackbar?.({
          message: msg,
          actionLabel: undoAction ? "Undo" : undefined,
          onAction: undoAction,
        });
      };

      switch (def.name) {
        case "help": {
          const targetCmd = parsed.positional[0];
          if (targetCmd) {
            const targetDef = findCommandDefinition(targetCmd);
            if (targetDef && isRoleAllowedForCommand(userRole, targetDef.minRole)) {
              setHelpDetailCmd(targetDef.name);
              onHelpModeChange(true);
              return;
            }
            const closeMatches = filterCommandsByQuery(targetCmd, userRole).slice(0, 3);
            setFeedback({
              type: "error",
              text:
                closeMatches.length > 0
                  ? `Unknown command "/${targetCmd}". Did you mean ${closeMatches
                      .map((c) => `/${c.name}`)
                      .join(", ")}?`
                  : `Unknown command "/${targetCmd}". Type /help to see available commands.`,
            });
            return;
          }
          setHelpDetailCmd(null);
          onHelpModeChange(true);
          return;
        }
        case "theme": {
          const mode = (parsed.positional[0] || "toggle").toLowerCase();
          if (mode === "dark" || mode === "light" || mode === "toggle") {
            const prevTheme = currentTheme;
            const nextTheme =
              mode === "toggle" ? (prevTheme === "dark" ? "light" : "dark") : mode;
            onSetTheme(mode);
            finishClientFeedback(`Switched to ${nextTheme} theme`, () => onSetTheme(prevTheme));
          } else {
            setFeedback({ type: "error", text: `Usage: ${def.usage}` });
          }
          return;
        }
        case "view": {
          const mode = (parsed.positional[0] || "").toLowerCase();
          if (mode === "kanban" || mode === "calendar") {
            recordCommandHistory(user.id, rawInput, def);
            onSetViewMode(mode);
            onOpenChange(false);
          } else {
            setFeedback({ type: "error", text: `Usage: ${def.usage}` });
          }
          return;
        }
        case "sidebar": {
          recordCommandHistory(user.id, rawInput, def);
          onToggleSidebar();
          onOpenChange(false);
          return;
        }
        case "members": {
          recordCommandHistory(user.id, rawInput, def);
          onOpenMembers();
          onOpenChange(false);
          return;
        }
        case "settings": {
          recordCommandHistory(user.id, rawInput, def);
          onOpenSettings();
          onOpenChange(false);
          return;
        }
        case "system": {
          recordCommandHistory(user.id, rawInput, def);
          onOpenSystem();
          onOpenChange(false);
          return;
        }
        case "docs": {
          const topic = parsed.positional.join(" ").trim().toLowerCase();
          const matched = topic
            ? DOCS_TOPICS.find(
                (t) => t.slug === topic || t.slug.includes(topic) || t.label.toLowerCase().includes(topic)
              )
            : undefined;
          const targetPath = matched ? matched.path : "/documentation";
          recordCommandHistory(user.id, rawInput, def);
          onOpenChange(false);
          window.location.assign(targetPath);
          return;
        }
        case "me": {
          finishClientFeedback(
            `Signed in as ${user.name} (${user.email}) · Role: ${userRole}`
          );
          return;
        }
        case "logout": {
          onOpenChange(false);
          onLogout();
          return;
        }
        case "open": {
          const key = (parsed.positional[0] || "").trim().toLowerCase();
          if (!key) {
            setFeedback({ type: "error", text: `Usage: ${def.usage}` });
            return;
          }
          const localMatch = tickets.find((t) => t.key.toLowerCase() === key);
          if (localMatch && boardId) {
            recordRecentPaletteItem(user.id, {
              kind: "ticket",
              id: localMatch.id,
              boardId,
              label: `${localMatch.key} · ${localMatch.title}`,
            });
            recordCommandHistory(user.id, rawInput, def);
            onSelectTicket(boardId, localMatch.id);
            onOpenChange(false);
            return;
          }
          const res = await fetch(`/api/search?q=${encodeURIComponent(key)}`);
          const data = (await res.json()) as { results?: SearchResultItem[] };
          const hit = data.results?.find((r) => r.ticketKey.toLowerCase() === key);
          if (hit) {
            recordRecentPaletteItem(user.id, {
              kind: "ticket",
              id: hit.ticketId,
              boardId: hit.boardId,
              label: `${hit.ticketKey} · ${hit.ticketTitle}`,
            });
            recordCommandHistory(user.id, rawInput, def);
            onSelectTicket(hit.boardId, hit.ticketId);
            onOpenChange(false);
          } else {
            setFeedback({ type: "error", text: `Ticket "${parsed.positional[0]}" not found.` });
          }
          return;
        }
        case "go": {
          const target = parsed.positional.join(" ").trim().toLowerCase();
          if (!target) {
            setFeedback({ type: "error", text: `Usage: ${def.usage}` });
            return;
          }
          const match = boards.find(
            (b) =>
              b.name.toLowerCase().includes(target) ||
              b.projectKey.toLowerCase() === target ||
              b.projectName.toLowerCase().includes(target) ||
              b.teamName.toLowerCase().includes(target)
          );
          if (match) {
            recordRecentPaletteItem(user.id, {
              kind: "board",
              id: match.id,
              boardId: match.id,
              label: `${match.projectKey} · ${match.name}`,
              sublabel: match.teamName,
            });
            recordCommandHistory(user.id, rawInput, def);
            onSelectBoard(match.id);
            onOpenChange(false);
          } else {
            setFeedback({ type: "error", text: `No matching board or project for "${target}".` });
          }
          return;
        }
        case "filter": {
          const expr = parsed.positional.join(" ").trim();
          if (!expr || expr.toLowerCase() === "clear") {
            recordCommandHistory(user.id, rawInput, def);
            onSetBoardFilter(null);
            onOpenChange(false);
            return;
          }
          const nextFilter: BoardFilterState = {};
          for (const token of parsed.positional) {
            const [k, v] = token.split(":");
            if (!v) continue;
            const kl = k.toLowerCase();
            if (kl === "priority") nextFilter.priority = v.toLowerCase();
            if (kl === "assignee") {
              nextFilter.assignee = v.toLowerCase() === "me" ? user.email : v.replace(/^@/, "");
            }
            if (kl === "label") nextFilter.label = v;
          }
          if (!nextFilter.priority && !nextFilter.assignee && !nextFilter.label) {
            setFeedback({
              type: "error",
              text: `Usage: ${def.usage} (e.g. ${def.examples[0]})`,
            });
            return;
          }
          recordCommandHistory(user.id, rawInput, def);
          onSetBoardFilter(nextFilter);
          onOpenChange(false);
          return;
        }
      }
    },
    [
      userRole,
      orgId,
      runServerCommand,
      onHelpModeChange,
      currentTheme,
      onSetTheme,
      onOpenChange,
      onShowSnackbar,
      onSetViewMode,
      onToggleSidebar,
      onOpenMembers,
      onOpenSettings,
      onOpenSystem,
      user,
      onLogout,
      tickets,
      boardId,
      onSelectTicket,
      boards,
      onSelectBoard,
      onSetBoardFilter,
    ]
  );

  const acceptCurrentCompletion = useCallback(() => {
    if (!parsedSlash.isCommand) return false;
    if (!parsedSlash.inArgumentMode && matchingCommands.length > 0) {
      if (selectedItemValue.startsWith("hist-")) {
        const idx = Number(selectedItemValue.slice(5));
        const entry = commandHistory[idx];
        if (entry) {
          userNavigatedRef.current = false;
          setQuery(entry);
          inputRef.current?.focus();
          return true;
        }
      }
      const matchedName = selectedItemValue.startsWith("cmd-") ? selectedItemValue.slice(4) : "";
      const target =
        matchingCommands.find((c) => c.name === matchedName) || matchingCommands[0];
      userNavigatedRef.current = false;
      setQuery(`/${target.name} `);
      inputRef.current?.focus();
      return true;
    }
    if (activeCommandDef && argSuggestions.length > 0) {
      const selectedArgVal = selectedItemValue.startsWith("arg-")
        ? selectedItemValue.slice(4)
        : "";
      const target =
        argSuggestions.find((s) => s.value === selectedArgVal) || argSuggestions[0];
      applyArgCompletion(target);
      return true;
    }
    return false;
  }, [
    parsedSlash,
    matchingCommands,
    selectedItemValue,
    commandHistory,
    activeCommandDef,
    argSuggestions,
    applyArgCompletion,
  ]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isSlashMode || helpMode || !parsedSlash.isCommand) return;

    const isBareOrEmptyArg =
      (!parsedSlash.inArgumentMode && parsedSlash.commandName === "") ||
      (Boolean(activeCommandDef) &&
        parsedSlash.inArgumentMode &&
        parsedSlash.hasTrailingSpace &&
        parsedSlash.allArgSpans.length === 0 &&
        !parsedSlash.activeOption);

    if (e.key === "ArrowUp") {
      if (
        isBareOrEmptyArg &&
        commandHistory.length > 0 &&
        (historyIndex >= 0 ||
          selectedItemValue === "" ||
          selectedItemValue === selectableValues[0])
      ) {
        e.preventDefault();
        if (historyIndex === -1) {
          historyDraftRef.current = query;
        }
        const nextIdx = Math.min(historyIndex + 1, commandHistory.length - 1);
        setHistoryIndex(nextIdx);
        setQuery(commandHistory[nextIdx]);
        userNavigatedRef.current = false;
        return;
      }
      if (selectableValues.length > 0) {
        e.preventDefault();
        userNavigatedRef.current = true;
        const curIdx = selectableValues.indexOf(selectedItemValue);
        const nextIdx = curIdx <= 0 ? selectableValues.length - 1 : curIdx - 1;
        setSelectedItemValue(selectableValues[nextIdx]);
        return;
      }
    }

    if (e.key === "ArrowDown") {
      if (historyIndex >= 0) {
        e.preventDefault();
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        setQuery(nextIdx < 0 ? historyDraftRef.current : commandHistory[nextIdx]);
        userNavigatedRef.current = false;
        return;
      }
      if (selectableValues.length > 0) {
        e.preventDefault();
        userNavigatedRef.current = true;
        const curIdx = selectableValues.indexOf(selectedItemValue);
        const nextIdx = curIdx < 0 ? 0 : (curIdx + 1) % selectableValues.length;
        setSelectedItemValue(selectableValues[nextIdx]);
        return;
      }
    }

    if (e.key === "Tab") {
      if (acceptCurrentCompletion()) {
        e.preventDefault();
        return;
      }
    }

    if (
      e.key === "ArrowRight" &&
      caretAtEnd &&
      parsedSlash.isCommand &&
      ((!parsedSlash.inArgumentMode && matchingCommands.length > 0) ||
        Boolean(ghostConfig?.activeText && !ghostConfig.activeIsPill))
    ) {
      e.preventDefault();
      acceptCurrentCompletion();
      return;
    }

    // Backspace on an empty argument returns to the previous token (positional or keyed) and restores its hint
    if (
      e.key === "Backspace" &&
      caretAtEnd &&
      parsedSlash.isCommand &&
      parsedSlash.inArgumentMode &&
      parsedSlash.hasTrailingSpace &&
      activeCommandDef
    ) {
      const lastSpan =
        parsedSlash.allArgSpans[parsedSlash.allArgSpans.length - 1] || null;
      if (lastSpan) {
        e.preventDefault();
        userNavigatedRef.current = false;
        setQuery(query.slice(0, lastSpan.start));
        return;
      }
    }

    if (e.key === "Enter" && pendingConfirm) {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        void executeSlashCommand(pendingConfirm.rawCommand, true, e.shiftKey);
      }
      return;
    }

    if (e.key === "Enter") {
      if (activeCommandDef && parsedSlash.isCommand) {
        const requiredCount = activeCommandDef.args.filter((a) => a.required).length;
        const isReady = parsedSlash.positional.length >= requiredCount && !parsedSlash.unknownKey;
        const activeIsIncomplete =
          parsedSlash.activeArgToken.length > 0 || parsedSlash.hasTrailingSpace;

        const selectedArgVal = selectedItemValue.startsWith("arg-")
          ? selectedItemValue.slice(4)
          : "";
        const highlightedArg = selectedArgVal
          ? argSuggestions.find((s) => s.value === selectedArgVal)
          : undefined;

        if (highlightedArg?.isOptionKey) {
          e.preventDefault();
          applyArgCompletion(highlightedArg);
          return;
        }

        // If command is incomplete and there is a suggestion, accept it first
        if (!isReady && activeIsIncomplete && argSuggestions.length > 0) {
          e.preventDefault();
          acceptCurrentCompletion();
          return;
        }
        e.preventDefault();
        void executeSlashCommand(query, false, e.shiftKey);
        return;
      }

      if (selectedItemValue.startsWith("hist-")) {
        const idx = Number(selectedItemValue.slice(5));
        const entry = commandHistory[idx];
        if (entry) {
          e.preventDefault();
          userNavigatedRef.current = false;
          setQuery(entry);
          return;
        }
      }

      if (matchingCommands.length > 0) {
        e.preventDefault();
        const exactCmd =
          !userNavigatedRef.current && parsedSlash.isCommand && parsedSlash.commandName
            ? matchingCommands.find(
                (c) =>
                  c.name === parsedSlash.commandName.toLowerCase() ||
                  c.aliases?.includes(parsedSlash.commandName.toLowerCase())
              )
            : undefined;
        const matchedName = selectedItemValue.startsWith("cmd-") ? selectedItemValue.slice(4) : "";
        const target =
          exactCmd ||
          matchingCommands.find((c) => c.name === matchedName) ||
          matchingCommands[0];
        if (target.args.every((a) => !a.required)) {
          void executeSlashCommand(`/${target.name}`, false, e.shiftKey);
        } else {
          userNavigatedRef.current = false;
          setQuery(`/${target.name} `);
        }
      }
    }
  };

  const matchesDocsSearch = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || isSlashMode) return false;
    return (
      "documentation".includes(q) ||
      "docs".includes(q) ||
      "manual".includes(q) ||
      "guide".includes(q)
    );
  }, [query, isSlashMode]);

  const hasAnySearchHits =
    matchesDocsSearch ||
    searchResults.length > 0 ||
    Boolean(
      searchGroups &&
        (searchGroups.boards.length > 0 ||
          searchGroups.projects.length > 0 ||
          searchGroups.teams.length > 0 ||
          searchGroups.people.length > 0 ||
          searchGroups.labels.length > 0)
    );

  const helpCategories = useMemo(() => {
    const groups = new Map<string, CommandDefinition[]>();
    for (const cmd of COMMAND_REGISTRY) {
      if (!isRoleAllowedForCommand(userRole, cmd.minRole)) continue;
      const list = groups.get(cmd.category) || [];
      list.push(cmd);
      groups.set(cmd.category, list);
    }
    return Array.from(groups.entries());
  }, [userRole]);

  const canAcceptMobile =
    isSlashMode &&
    !helpMode &&
    parsedSlash.isCommand &&
    ((!parsedSlash.inArgumentMode && matchingCommands.length > 0) ||
      (Boolean(activeCommandDef) && argSuggestions.length > 0));

  const handlePointerMoveSelect = useCallback(
    (itemVal: string, e: React.PointerEvent) => {
      const prev = lastPointerPosRef.current;
      if (prev && prev.x === e.clientX && prev.y === e.clientY) return;
      lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
      userNavigatedRef.current = true;
      setSelectedItemValue(itemVal);
    },
    []
  );

  const helpDetailDef = useMemo(() => {
    if (!helpDetailCmd) return null;
    const found = findCommandDefinition(helpDetailCmd);
    if (!found || !isRoleAllowedForCommand(userRole, found.minRole)) return null;
    return found;
  }, [helpDetailCmd, userRole]);

  const showRecentCommands =
    isSlashMode &&
    !helpMode &&
    !activeCommandDef &&
    parsedSlash.isCommand &&
    parsedSlash.commandName === "" &&
    commandHistory.length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      onEscapeKeyDown={(e) => {
        if (helpMode && helpDetailCmd) {
          e.preventDefault();
          e.stopPropagation();
          setHelpDetailCmd(null);
        }
      }}
    >
      <Command
        shouldFilter={false}
        label="Patchwork Command Bar"
        value={selectedItemValue}
        onValueChange={(v) => setSelectedItemValue(v)}
      >
        <CommandInput
          ref={inputRef}
          data-testid="global-search-input"
          value={query}
          ghost={ghostConfig}
          onCaretChange={(atEnd) => setCaretAtEnd(atEnd)}
          onValueChange={(val) => {
            setQuery(val);
            setPendingConfirm(null);
            setFeedback(null);
            setHistoryIndex(-1);
            userNavigatedRef.current = false;
            if (helpMode && val.trim() !== "") {
              setHelpDetailCmd(null);
              onHelpModeChange(false);
            }
          }}
          onKeyDown={handleInputKeyDown}
          showClear={query.length > 0}
          onClear={() => {
            setQuery("");
            setFeedback(null);
            setPendingConfirm(null);
            setHistoryIndex(-1);
            userNavigatedRef.current = false;
            inputRef.current?.focus();
          }}
          placeholder="Search tickets, boards, people, or type / for commands..."
        />

        {validationError && (
          <div
            role="status"
            data-testid="command-arg-error"
            className="border-b border-[var(--pw-border)] bg-[var(--pw-bg)] px-3.5 py-1.5 text-xs text-[var(--pw-ink-secondary)]"
          >
            {validationError.message}
          </div>
        )}

        {feedback && (
          <div
            role="status"
            data-testid="command-feedback"
            className={`mx-2 mt-2 flex items-center justify-between rounded-md border px-3 py-2 text-xs ${
              feedback.type === "error"
                ? "border-red-500/30 bg-red-500/10 text-red-500"
                : feedback.type === "ok"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                : "border-[var(--pw-border)] bg-[var(--pw-bg)] text-[var(--pw-ink)]"
            }`}
          >
            <span>{feedback.text}</span>
          </div>
        )}

        {pendingConfirm && (
          <div
            role="alert"
            data-testid="command-confirm-banner"
            className="mx-2 mt-2 flex flex-col gap-2.5 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs"
          >
            <div className="flex items-start gap-2 text-red-600 dark:text-red-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="font-semibold">
                  {pendingConfirm.ticketContext
                    ? `${pendingConfirm.def.name === "delete" ? "Delete" : "Archive"} ${pendingConfirm.ticketContext.key}: ${pendingConfirm.ticketContext.title}`
                    : pendingConfirm.def.confirmLabel || `Confirm /${pendingConfirm.def.name}`}
                </div>
                {pendingConfirm.ticketContext && (
                  <div
                    data-testid="command-confirm-context"
                    className="text-[11px] text-[var(--pw-ink-secondary)]"
                  >
                    Board: {pendingConfirm.ticketContext.boardName} · Column:{" "}
                    {pendingConfirm.ticketContext.columnName} · Assignee:{" "}
                    {pendingConfirm.ticketContext.assigneeName}
                  </div>
                )}
                <div className="text-[11px] text-[var(--pw-ink-secondary)]">
                  {pendingConfirm.def.name === "delete"
                    ? "This permanently deletes the ticket, its comments, and its attachments."
                    : pendingConfirm.def.name === "archive"
                    ? "This archives the ticket and hides it from the board."
                    : "You will be signed out of your current session."}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                ref={cancelConfirmRef}
                type="button"
                data-testid="command-confirm-cancel-btn"
                onClick={() => {
                  setPendingConfirm(null);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
                className="min-h-[44px] sm:min-h-0 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-3 py-1.5 text-xs font-medium text-[var(--pw-ink)] hover:bg-[var(--pw-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--pw-accent)]"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="command-confirm-btn"
                disabled={executing}
                onClick={() => void executeSlashCommand(pendingConfirm.rawCommand, true)}
                className="min-h-[44px] sm:min-h-0 rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-red-400"
              >
                {executing
                  ? "Running..."
                  : pendingConfirm.ticketContext
                  ? `${pendingConfirm.def.name === "delete" ? "Delete" : "Archive"} ${pendingConfirm.ticketContext.key}`
                  : pendingConfirm.def.name === "logout"
                  ? "Sign out"
                  : "Confirm"}
              </button>
            </div>
          </div>
        )}

        {isSlashMode && !helpMode && activeCommandDef && activeArgHeader && (
          <div
            data-testid="command-active-arg-desc"
            className="border-b border-[var(--pw-border)] px-3.5 py-1.5 text-[11px] text-[var(--pw-ink-secondary)]"
          >
            {activeArgHeader}
          </div>
        )}

        {helpMode && !helpDetailDef && (
          <div
            data-testid="command-help-view"
            className="flex items-center justify-between border-b border-[var(--pw-border)] px-3.5 py-2"
          >
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--pw-ink-muted)]">
              Command Reference & Search Filters
            </span>
            <button
              type="button"
              onClick={() => onHelpModeChange(false)}
              className="text-[11px] text-[var(--pw-accent)] hover:underline"
            >
              Back to search
            </button>
          </div>
        )}

        {helpMode && helpDetailDef ? (
          <div className="max-h-[60vh] overflow-y-auto space-y-3 p-3" data-testid="command-help-detail">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                data-testid="command-help-back-btn"
                onClick={() => setHelpDetailCmd(null)}
                className="inline-flex min-h-[36px] sm:min-h-0 items-center gap-1.5 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2 py-1 text-[11px] text-[var(--pw-ink)] hover:bg-[var(--pw-surface-hover)]"
              >
                <kbd className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-1 font-mono text-[10px]">
                  Esc
                </kbd>
                <span>Back</span>
              </button>
              <div className="flex items-center gap-1.5 text-[10px] font-mono">
                <span className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-1.5 py-0.5 text-[var(--pw-ink-secondary)]">
                  role: {helpDetailDef.minRole}
                </span>
                {helpDetailDef.destructive && (
                  <span className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-red-500">
                    destructive
                  </span>
                )}
                {helpDetailDef.undoable && (
                  <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400">
                    undoable
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-1 rounded-md border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3">
              <div className="font-mono text-sm font-semibold text-[var(--pw-ink)]">
                {helpDetailDef.usage}
              </div>
              <div className="text-xs text-[var(--pw-ink-secondary)]">
                {helpDetailDef.description}
              </div>
            </div>

            {helpDetailDef.args.length > 0 && (
              <div className="space-y-1.5">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--pw-ink-muted)]">
                  Arguments
                </div>
                <div className="space-y-1">
                  {helpDetailDef.args.map((arg) => (
                    <div
                      key={arg.name}
                      className="flex flex-wrap items-baseline justify-between gap-2 rounded border border-[var(--pw-border)] px-2.5 py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-[var(--pw-ink)]">
                          {arg.label}
                        </span>
                        <span className="font-mono text-[10px] text-[var(--pw-ink-muted)]">
                          {arg.typeName} · {arg.required ? "required" : "optional"}
                        </span>
                      </div>
                      <span className="text-[11px] text-[var(--pw-ink-secondary)]">
                        {arg.description}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {helpDetailDef.options && helpDetailDef.options.length > 0 && (
              <div className="space-y-1.5">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--pw-ink-muted)]">
                  Options
                </div>
                <div className="space-y-1">
                  {helpDetailDef.options.map((opt) => (
                    <div
                      key={opt.key}
                      className="flex flex-wrap items-baseline justify-between gap-2 rounded border border-[var(--pw-border)] px-2.5 py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-[var(--pw-ink)]">
                          {opt.key}:{opt.typeName}
                        </span>
                        <span className="font-mono text-[10px] text-[var(--pw-ink-muted)]">
                          optional
                        </span>
                      </div>
                      <span className="text-[11px] text-[var(--pw-ink-secondary)]">
                        {opt.description}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {helpDetailDef.examples.length > 0 && (
              <div className="space-y-1.5">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--pw-ink-muted)]">
                  Examples (click to insert)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {helpDetailDef.examples.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      data-testid="command-help-example-btn"
                      onClick={() => {
                        setHelpDetailCmd(null);
                        onHelpModeChange(false);
                        setQuery(ex);
                        requestAnimationFrame(() => inputRef.current?.focus());
                      }}
                      className="min-h-[36px] sm:min-h-0 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1 font-mono text-[11px] text-[var(--pw-ink)] hover:bg-[var(--pw-surface-hover)]"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}

        <CommandList
          data-testid="search-results"
          hidden={Boolean(
            (helpMode && helpDetailDef) ||
              (isSlashMode && !helpMode && activeCommandDef && argSuggestions.length === 0)
          )}
        >
          {helpMode && !helpDetailDef ? (
            <>
              {helpCategories.map(([cat, cmds]) => (
                <CommandGroup key={cat} heading={cat}>
                  {cmds.map((cmd) => (
                    <CommandItem
                      key={cmd.name}
                      value={`help-${cmd.name}`}
                      onSelect={() => {
                        setHelpDetailCmd(cmd.name);
                      }}
                    >
                      {getCommandIcon(cmd.name)}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-semibold text-[var(--pw-ink)]">
                            /{cmd.name}
                          </span>
                          <span className="truncate font-mono text-[11px] text-[var(--pw-ink-muted)]">
                            {cmd.usage}
                          </span>
                        </div>
                        <div className="text-[11px] text-[var(--pw-ink-secondary)]">
                          {cmd.description}
                        </div>
                        {cmd.examples[0] && (
                          <span
                            data-testid={`help-example-${cmd.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setHelpDetailCmd(null);
                              onHelpModeChange(false);
                              setQuery(cmd.examples[0]);
                              requestAnimationFrame(() => inputRef.current?.focus());
                            }}
                            className="mt-1 inline-flex cursor-pointer rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-hover)] hover:text-[var(--pw-ink)]"
                          >
                            e.g. {cmd.examples[0]}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </>
          ) : !helpMode && isSlashMode ? (
            <>
              {activeCommandDef ? (
                argSuggestions.length > 0 ? (
                  <CommandGroup heading={isShowingOptionKeys ? "Options" : "Suggestions"}>
                    {argSuggestions.map((s) => {
                      const itemVal = `arg-${s.value}`;
                      return (
                        <CommandItem
                          key={s.value}
                          value={itemVal}
                          onPointerMove={(e) => handlePointerMoveSelect(itemVal, e)}
                          onSelect={() => applyArgCompletion(s)}
                        >
                          <Hash className="h-3.5 w-3.5 text-[var(--pw-ink-muted)]" />
                          <span className="font-mono font-medium text-[var(--pw-ink)]">
                            {s.label}
                          </span>
                          {s.hint && (
                            <span className="truncate text-[11px] text-[var(--pw-ink-muted)]">
                              {s.hint}
                            </span>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ) : null
              ) : matchingCommands.length === 0 ? (
                <CommandEmpty>
                  No matching slash command. Type <code>/help</code> to see all commands.
                </CommandEmpty>
              ) : (
                <>
                  {showRecentCommands && (
                    <CommandGroup heading="Recent commands">
                      {commandHistory.slice(0, 5).map((entry, idx) => {
                        const itemVal = `hist-${idx}`;
                        return (
                          <CommandItem
                            key={`hist-${entry}`}
                            value={itemVal}
                            onPointerMove={(e) => handlePointerMoveSelect(itemVal, e)}
                            onSelect={() => {
                              userNavigatedRef.current = false;
                              setQuery(entry);
                              inputRef.current?.focus();
                            }}
                          >
                            <Terminal className="h-3.5 w-3.5 text-[var(--pw-ink-muted)]" />
                            <span className="truncate font-mono text-[var(--pw-ink)]">
                              {entry}
                            </span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  )}
                  <CommandGroup heading="Slash Commands">
                    {matchingCommands.map((cmd) => {
                      const itemVal = `cmd-${cmd.name}`;
                      return (
                        <CommandItem
                          key={cmd.name}
                          value={itemVal}
                          onPointerMove={(e) => handlePointerMoveSelect(itemVal, e)}
                          onSelect={() => {
                            if (cmd.args.length === 0) {
                              void executeSlashCommand(`/${cmd.name}`);
                            } else {
                              userNavigatedRef.current = false;
                              setQuery(`/${cmd.name} `);
                              inputRef.current?.focus();
                            }
                          }}
                        >
                          {getCommandIcon(cmd.name)}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-[var(--pw-ink)]">
                                /{cmd.name}
                              </span>
                              <span className="truncate text-[11px] text-[var(--pw-ink-secondary)]">
                                {cmd.description}
                              </span>
                            </div>
                          </div>
                          <CommandShortcut>{cmd.category}</CommandShortcut>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </>
              )}
            </>
          ) : query.trim() === "" ? (
            <>
              {recentItems.length > 0 && (
                <CommandGroup heading="Recent">
                  {recentItems.map((item) => (
                    <CommandItem
                      key={`${item.kind}-${item.id}`}
                      value={`recent-${item.kind}-${item.id}`}
                      onSelect={() => {
                        if (item.kind === "ticket") {
                          onSelectTicket(item.boardId, item.id);
                        } else {
                          onSelectBoard(item.boardId);
                        }
                        onOpenChange(false);
                      }}
                    >
                      {item.kind === "ticket" ? (
                        <Ticket className="h-3.5 w-3.5 text-[var(--pw-accent)]" />
                      ) : (
                        <FolderKanban className="h-3.5 w-3.5 text-[var(--pw-accent)]" />
                      )}
                      <span className="truncate font-medium text-[var(--pw-ink)]">
                        {item.label}
                      </span>
                      {item.sublabel && (
                        <span className="ml-auto text-[11px] text-[var(--pw-ink-muted)]">
                          {item.sublabel}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {recentItems.length > 0 && <CommandSeparator />}

              <CommandGroup heading="Quick Commands">
                {matchingCommands.map((cmd) => (
                  <CommandItem
                    key={cmd.name}
                    value={`quick-${cmd.name}`}
                    onSelect={() => {
                      if (cmd.args.length === 0) {
                        void executeSlashCommand(`/${cmd.name}`);
                      } else {
                        setQuery(`/${cmd.name} `);
                        inputRef.current?.focus();
                      }
                    }}
                  >
                    {getCommandIcon(cmd.name)}
                    <span className="font-mono font-semibold text-[var(--pw-ink)]">
                      /{cmd.name}
                    </span>
                    <span className="truncate text-[11px] text-[var(--pw-ink-secondary)]">
                      {cmd.description}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : isSearching && !hasAnySearchHits ? (
            <SearchPaletteSkeleton />
          ) : !hasAnySearchHits ? (
            <CommandEmpty>
              No matching tickets, comments, attachments, boards, or people found.
            </CommandEmpty>
          ) : (
            <>
              <RouteProgressBar active={isSearching} label="Searching workspace..." />
              {searchGroups && searchGroups.tickets.length > 0 && (
                <CommandGroup heading="Tickets">
                  {searchGroups.tickets.map((hit) => (
                    <CommandItem
                      key={`ticket-${hit.id}`}
                      data-testid={`search-result-${hit.ticketKey}`}
                      value={`ticket-${hit.id}`}
                      onSelect={() => {
                        recordRecentPaletteItem(user.id, {
                          kind: "ticket",
                          id: hit.ticketId,
                          boardId: hit.boardId,
                          label: `${hit.ticketKey} · ${hit.ticketTitle}`,
                        });
                        onSelectTicket(hit.boardId, hit.ticketId);
                        onOpenChange(false);
                      }}
                    >
                      <Ticket className="h-3.5 w-3.5 shrink-0 text-[var(--pw-accent)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-[var(--pw-surface-muted)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--pw-accent)]">
                            {hit.ticketKey}
                          </span>
                          <span className="truncate font-medium text-[var(--pw-ink)]">
                            {hit.ticketTitle}
                          </span>
                        </div>
                        {hit.snippet && (
                          <div
                            className="mt-0.5 truncate text-[11px] text-[var(--pw-ink-secondary)]"
                            dangerouslySetInnerHTML={{ __html: hit.snippet }}
                          />
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {searchGroups && searchGroups.comments.length > 0 && (
                <CommandGroup heading="Comments">
                  {searchGroups.comments.map((hit) => (
                    <CommandItem
                      key={`comment-${hit.id}`}
                      data-testid={`search-result-${hit.ticketKey}`}
                      value={`comment-${hit.id}`}
                      onSelect={() => {
                        onSelectTicket(hit.boardId, hit.ticketId);
                        onOpenChange(false);
                      }}
                    >
                      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-[var(--pw-ink-muted)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] font-semibold text-[var(--pw-accent)]">
                            {hit.ticketKey}
                          </span>
                          <span className="truncate font-medium text-[var(--pw-ink)]">
                            {hit.ticketTitle}
                          </span>
                        </div>
                        <div
                          className="mt-0.5 truncate text-[11px] text-[var(--pw-ink-secondary)]"
                          dangerouslySetInnerHTML={{ __html: hit.snippet }}
                        />
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {searchGroups && searchGroups.attachments.length > 0 && (
                <CommandGroup heading="Attachments">
                  {searchGroups.attachments.map((hit) => (
                    <CommandItem
                      key={`att-${hit.id}`}
                      data-testid={`search-result-${hit.ticketKey}`}
                      value={`att-${hit.id}`}
                      onSelect={() => {
                        onSelectTicket(hit.boardId, hit.ticketId);
                        onOpenChange(false);
                      }}
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--pw-ink-muted)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] font-semibold text-[var(--pw-accent)]">
                            {hit.ticketKey}
                          </span>
                          <span className="truncate font-medium text-[var(--pw-ink)]">
                            {hit.filename || hit.ticketTitle}
                          </span>
                        </div>
                        <div
                          className="mt-0.5 truncate text-[11px] text-[var(--pw-ink-secondary)]"
                          dangerouslySetInnerHTML={{ __html: hit.snippet }}
                        />
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {searchGroups && searchGroups.boards.length > 0 && (
                <CommandGroup heading="Boards">
                  {searchGroups.boards.map((b) => (
                    <CommandItem
                      key={`board-${b.id}`}
                      value={`board-${b.id}`}
                      onSelect={() => {
                        recordRecentPaletteItem(user.id, {
                          kind: "board",
                          id: b.id,
                          boardId: b.id,
                          label: `${b.projectKey} · ${b.name}`,
                          sublabel: b.teamName,
                        });
                        onSelectBoard(b.id);
                        onOpenChange(false);
                      }}
                    >
                      <FolderKanban className="h-3.5 w-3.5 text-[var(--pw-accent)]" />
                      <span className="font-mono text-[10px] font-semibold text-[var(--pw-accent)]">
                        {b.projectKey}
                      </span>
                      <span className="font-medium text-[var(--pw-ink)]">{b.name}</span>
                      <span className="ml-auto text-[11px] text-[var(--pw-ink-muted)]">
                        {b.teamName}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {searchGroups && searchGroups.projects.length > 0 && (
                <CommandGroup heading="Projects">
                  {searchGroups.projects.map((p) => {
                    const targetBoard = boards.find((b) => b.projectKey === p.key);
                    return (
                      <CommandItem
                        key={`proj-${p.id}`}
                        value={`proj-${p.id}`}
                        onSelect={() => {
                          if (targetBoard) {
                            onSelectBoard(targetBoard.id);
                          }
                          onOpenChange(false);
                        }}
                      >
                        <LayoutGrid className="h-3.5 w-3.5 text-[var(--pw-ink-muted)]" />
                        <span className="font-mono text-[10px] font-semibold text-[var(--pw-accent)]">
                          {p.key}
                        </span>
                        <span className="font-medium text-[var(--pw-ink)]">{p.name}</span>
                        <span className="ml-auto text-[11px] text-[var(--pw-ink-muted)]">
                          {p.teamName}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {searchGroups && searchGroups.teams.length > 0 && (
                <CommandGroup heading="Teams">
                  {searchGroups.teams.map((tm) => {
                    const targetBoard = boards.find((b) => b.teamId === tm.id);
                    return (
                      <CommandItem
                        key={`team-${tm.id}`}
                        value={`team-${tm.id}`}
                        onSelect={() => {
                          if (targetBoard) {
                            onSelectBoard(targetBoard.id);
                          }
                          onOpenChange(false);
                        }}
                      >
                        <Users className="h-3.5 w-3.5 text-[var(--pw-ink-muted)]" />
                        <span className="font-medium text-[var(--pw-ink)]">{tm.name}</span>
                        <span className="ml-auto font-mono text-[10px] text-[var(--pw-ink-muted)]">
                          {tm.slug}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {searchGroups && searchGroups.people.length > 0 && (
                <CommandGroup heading="People">
                  {searchGroups.people.map((person) => (
                    <CommandItem
                      key={`person-${person.id}`}
                      value={`person-${person.id}`}
                      onSelect={() => {
                        onSetBoardFilter({ assignee: person.email });
                        onOpenChange(false);
                      }}
                    >
                      <User className="h-3.5 w-3.5 text-[var(--pw-ink-muted)]" />
                      <span className="font-medium text-[var(--pw-ink)]">{person.name}</span>
                      <span className="text-[11px] text-[var(--pw-ink-muted)]">{person.email}</span>
                      <span className="ml-auto text-[11px] text-[var(--pw-ink-muted)]">
                        Filter board
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {matchesDocsSearch && (
                <CommandGroup heading="Documentation">
                  <CommandItem
                    value="nav-documentation"
                    onSelect={() => {
                      onOpenChange(false);
                      window.location.assign("/documentation");
                    }}
                  >
                    <BookOpen className="h-3.5 w-3.5 text-[var(--pw-accent)]" />
                    <span className="font-medium text-[var(--pw-ink)]">Documentation</span>
                    <span className="ml-auto text-[11px] text-[var(--pw-ink-secondary)]">
                      /documentation
                    </span>
                  </CommandItem>
                </CommandGroup>
              )}

              {searchGroups && searchGroups.labels.length > 0 && (
                <CommandGroup heading="Labels">
                  {searchGroups.labels.map((lbl) => (
                    <CommandItem
                      key={`label-${lbl.label}`}
                      value={`label-${lbl.label}`}
                      onSelect={() => {
                        onSetBoardFilter({ label: lbl.label });
                        onOpenChange(false);
                      }}
                    >
                      <Tag className="h-3.5 w-3.5 text-[var(--pw-ink-muted)]" />
                      <span className="font-medium text-[var(--pw-ink)]">{lbl.label}</span>
                      <span className="ml-auto font-mono text-[10px] text-[var(--pw-ink-muted)]">
                        {lbl.count} tickets
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </>
          )}
        </CommandList>

        {canAcceptMobile && (
          <div
            data-testid="command-mobile-accept"
            style={{ bottom: `${keyboardOffset}px` }}
            className="sm:hidden sticky z-20 flex items-center justify-between gap-2 border-t border-[var(--pw-border)] bg-[var(--pw-surface)] px-3 py-1.5"
          >
            <span className="truncate text-[11px] text-[var(--pw-ink-secondary)]">
              {parsedSlash.isCommand && !parsedSlash.inArgumentMode && matchingCommands[0]
                ? `/${matchingCommands[0].name}`
                : argSuggestions[0]?.label || ""}
            </span>
            <button
              type="button"
              data-testid="command-mobile-accept-btn"
              onClick={() => acceptCurrentCompletion()}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded bg-[#C84317] hover:bg-[#AF3810] px-3 text-xs font-semibold text-white"
            >
              <Check className="h-3.5 w-3.5" />
              <span>Accept</span>
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 text-[11px] text-[var(--pw-ink-muted)]">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-1 font-mono text-[10px]">
                ↑↓
              </kbd>{" "}
              navigate
            </span>
            <span>
              <kbd className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-1 font-mono text-[10px]">
                Enter
              </kbd>{" "}
              select
            </span>
            <span>
              <kbd className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-1 font-mono text-[10px]">
                Tab
              </kbd>{" "}
              complete
            </span>
            <span className="hidden sm:inline">
              <kbd className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-1 font-mono text-[10px]">
                Shift+Enter
              </kbd>{" "}
              keep open
            </span>
          </div>
          <button
            type="button"
            onClick={() => onHelpModeChange(!helpMode)}
            className="flex items-center gap-1 hover:text-[var(--pw-ink)]"
          >
            <HelpCircle className="h-3 w-3" />
            <span>Help ({formatShortcut(shortcuts.paletteHelp)})</span>
          </button>
        </div>
      </Command>
    </CommandDialog>
  );
}
