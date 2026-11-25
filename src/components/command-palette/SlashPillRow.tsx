"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type {
  CommandArgAutocomplete,
  CommandArgInputType,
  CommandDefinition,
  CommandOptionSpec,
} from "@/lib/commands/registry";

export interface SlashPillItem {
  id: string;
  kind: "positional" | "option";
  key: string;
  label: string;
  placeholder: string;
  argType: CommandArgInputType;
  autocomplete: CommandArgAutocomplete;
  description: string;
  required: boolean;
  value: string;
}

interface SlashPillRowProps {
  command: CommandDefinition;
  pills: SlashPillItem[];
  activePillIndex: number;
  ghostOptions: CommandOptionSpec[];
  invalidPillId?: string | null;
  liveAnnouncement: string;
  isSuggestionsOpen: boolean;
  listboxId?: string;
  activeDescendantId?: string;
  showTabHint?: boolean;
  readyToRun?: boolean;
  onActivePillChange: (index: number) => void;
  onPillValueChange: (index: number, value: string) => void;
  onPillKeyDown: (index: number, e: React.KeyboardEvent<HTMLInputElement>, isComposing: boolean) => void;
  onPillPaste: (index: number, e: React.ClipboardEvent<HTMLInputElement>) => void;
  onRemovePill: (index: number) => void;
  onPromoteGhostOption: (opt: CommandOptionSpec) => void;
  onClear: () => void;
  focusRequestTick: number;
  caretPlacementRef: React.MutableRefObject<"start" | "end" | null>;
}

const PILL_SURFACE_CLASS =
  "inline-flex items-center rounded border border-[var(--pw-border)] bg-[var(--pw-surface-muted)] px-2 py-0.5 text-sm leading-5 font-normal text-[var(--pw-ghost-active)] forced-colors:border-[ButtonText] max-sm:min-h-[44px]";

function PillInput({
  pill,
  isActive,
  isInvalid,
  isSuggestionsOpen,
  listboxId,
  activeDescendantId,
  inputRef,
  onFocus,
  onChange,
  onKeyDown,
  onPaste,
  onRemove,
}: {
  pill: SlashPillItem;
  isActive: boolean;
  isInvalid: boolean;
  isSuggestionsOpen: boolean;
  listboxId?: string;
  activeDescendantId?: string;
  inputRef: (el: HTMLInputElement | null) => void;
  onFocus: () => void;
  onChange: (val: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, isComposing: boolean) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  onRemove?: () => void;
}) {
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const mirrorRef = useRef<HTMLSpanElement | null>(null);
  const composingRef = useRef(false);
  const [inputWidth, setInputWidth] = useState(24);

  const measureText = pill.value.length > 0 ? pill.value : pill.placeholder;

  useLayoutEffect(() => {
    const mirror = mirrorRef.current;
    if (!mirror) return;
    const w = Math.ceil(mirror.getBoundingClientRect().width);
    setInputWidth(Math.max(w + 2, 16));
  }, [measureText]);

  const setRefs = useCallback(
    (node: HTMLInputElement | null) => {
      localInputRef.current = node;
      inputRef(node);
    },
    [inputRef]
  );

  const ariaLabel = `${pill.label}, ${pill.required ? "required" : "optional"} — ${pill.description}`;

  return (
    <div
      data-testid="command-arg-pill"
      data-pill-key={pill.key}
      data-pill-kind={pill.kind}
      data-pill-active={isActive ? "true" : "false"}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        e.preventDefault();
        localInputRef.current?.focus();
      }}
      className={`${PILL_SURFACE_CLASS} group/pill relative max-w-full cursor-text transition-opacity ${
        isActive ? "ring-2 ring-[var(--pw-accent)]/75" : ""
      } ${isInvalid ? "border-b-2 border-b-amber-500/80" : ""}`}
    >
      <span
        data-testid={`command-pill-label-${pill.key}`}
        className="select-none whitespace-pre text-sm leading-5 font-normal text-[var(--pw-ghost-active)]"
      >
        {pill.label}:{" "}
      </span>

      <span
        ref={mirrorRef}
        aria-hidden="true"
        className="pointer-events-none invisible fixed -left-[9999px] -top-[9999px] whitespace-pre text-sm leading-5 font-normal"
      >
        {measureText}
      </span>

      <input
        ref={setRefs}
        type="text"
        value={pill.value}
        placeholder={pill.placeholder}
        aria-label={ariaLabel}
        data-testid={`command-pill-input-${pill.key}`}
        role={isActive ? "combobox" : undefined}
        aria-expanded={isActive ? isSuggestionsOpen : undefined}
        aria-controls={isActive ? listboxId : undefined}
        aria-activedescendant={isActive ? activeDescendantId : undefined}
        aria-autocomplete={isActive ? "list" : undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        style={{ width: `${inputWidth}px` }}
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.value)}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === "Home" || e.key === "End") {
            e.stopPropagation();
          }
          onKeyDown(e, composingRef.current);
        }}
        onPaste={onPaste}
        className="pw-pill-input min-w-[16px] max-w-[260px] sm:max-w-[360px] bg-transparent text-sm leading-5 font-normal text-[var(--pw-ghost-active)] placeholder:text-[var(--pw-ghost-active)] outline-none"
      />

      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${pill.label}`}
          data-testid={`command-remove-pill-${pill.key}`}
          className="ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover/pill:opacity-100 group-focus-within/pill:opacity-100 focus-visible:opacity-100 max-sm:h-7 max-sm:w-7 max-sm:opacity-100 hover:bg-black/10 dark:hover:bg-white/10"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export function SlashPillRow({
  command,
  pills,
  activePillIndex,
  ghostOptions,
  invalidPillId,
  liveAnnouncement,
  isSuggestionsOpen,
  listboxId,
  activeDescendantId,
  showTabHint,
  readyToRun,
  onActivePillChange,
  onPillValueChange,
  onPillKeyDown,
  onPillPaste,
  onRemovePill,
  onPromoteGhostOption,
  onClear,
  focusRequestTick,
  caretPlacementRef,
}: SlashPillRowProps) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const [hasGhostRoom, setHasGhostRoom] = useState(true);

  useEffect(() => {
    const el = inputRefs.current[activePillIndex];
    if (!el) return;
    el.focus();
    const placement = caretPlacementRef.current;
    if (placement === "start") {
      el.setSelectionRange(0, 0);
    } else if (placement === "end") {
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
    caretPlacementRef.current = null;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activePillIndex, focusRequestTick, caretPlacementRef]);

  useLayoutEffect(() => {
    const grp = groupRef.current;
    if (!grp) return;
    setHasGhostRoom(grp.clientWidth >= 340);
  }, [pills, ghostOptions.length]);

  const activePill = pills[activePillIndex];
  const showGhostOptions = Boolean(
    hasGhostRoom &&
      ghostOptions.length > 0 &&
      activePill &&
      activePill.value.trim().length > 0
  );

  return (
    <div
      className="flex items-center gap-2 border-b border-[var(--pw-border)] px-3.5 py-2.5"
      cmdk-input-wrapper=""
    >
      <Search className="h-4 w-4 shrink-0 text-[var(--pw-ink-muted)]" />

      <div
        ref={groupRef}
        role="group"
        aria-label="Command"
        data-testid="command-pill-group"
        className="flex flex-1 min-w-0 flex-wrap items-center gap-2.5 px-0.5 py-0.5 max-h-[5rem] overflow-y-auto"
      >
        <span
          data-testid="command-pill-cmd"
          className="shrink-0 select-none text-sm leading-7 text-[var(--pw-ink)]"
        >
          /{command.name}
        </span>

        {pills.map((pill, idx) => (
          <PillInput
            key={pill.id}
            pill={pill}
            isActive={idx === activePillIndex}
            isInvalid={invalidPillId === pill.id}
            isSuggestionsOpen={isSuggestionsOpen}
            listboxId={listboxId}
            activeDescendantId={activeDescendantId}
            inputRef={(el) => {
              inputRefs.current[idx] = el;
            }}
            onFocus={() => onActivePillChange(idx)}
            onChange={(val) => onPillValueChange(idx, val)}
            onKeyDown={(e, isComposing) => onPillKeyDown(idx, e, isComposing)}
            onPaste={(e) => onPillPaste(idx, e)}
            onRemove={pill.kind === "option" ? () => onRemovePill(idx) : undefined}
          />
        ))}

        {showGhostOptions && (
          <div
            data-testid="command-ghost-options"
            className="ml-1 inline-flex flex-wrap items-center gap-2"
          >
            {ghostOptions.map((opt) => (
              <button
                key={opt.key}
                type="button"
                tabIndex={-1}
                data-testid={`command-ghost-pill-${opt.key}`}
                onClick={() => onPromoteGhostOption(opt)}
                className={`${PILL_SURFACE_CLASS} cursor-pointer opacity-85 hover:opacity-100`}
              >
                {opt.key}:
              </button>
            ))}
          </div>
        )}

        {readyToRun && (
          <span
            data-testid="command-ghost-run"
            className="inline-flex items-center rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-1 py-0 font-mono text-[10px] leading-4 text-[var(--pw-ghost-rest)]"
          >
            ↵ Run
          </span>
        )}
      </div>

      <span className="sr-only" aria-live="polite" data-testid="command-aria-live">
        {liveAnnouncement}
      </span>

      {showTabHint && (
        <kbd
          data-testid="command-tab-hint"
          className="hidden sm:inline-flex shrink-0 items-center rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--pw-ink-muted)]"
        >
          Tab
        </kbd>
      )}

      <button
        type="button"
        onClick={onClear}
        aria-label="Clear command input"
        className="rounded p-1 text-[var(--pw-ink-muted)] hover:bg-[var(--pw-surface-hover)] hover:text-[var(--pw-ink)] max-sm:min-h-[44px] max-sm:min-w-[44px] max-sm:flex max-sm:items-center max-sm:justify-center"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
