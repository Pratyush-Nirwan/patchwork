"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { apiFetchJson } from "@/lib/api-client";
import { Skeleton, SkeletonCircle, Surface } from "@/components/ui/skeleton";

export interface MentionCandidate {
  id: string;
  name: string;
}

interface MentionTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
  value: string;
  onChange: (nextValue: string) => void;
  ticketId?: string;
  fallbackCandidates?: MentionCandidate[];
  onTyping?: () => void;
}

function findActiveAtTrigger(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const atIdx = before.lastIndexOf("@");
  if (atIdx === -1) return null;
  if (atIdx > 0 && !/[\s(]/.test(before[atIdx - 1])) return null;
  const query = before.slice(atIdx + 1);
  if (/[\s\n\r\]`]/.test(query)) return null;
  return { start: atIdx, query };
}

const EMPTY_CANDIDATES: MentionCandidate[] = [];

export function MentionTextarea({
  value,
  onChange,
  ticketId,
  fallbackCandidates = EMPTY_CANDIDATES,
  onTyping,
  onKeyDown,
  className = "",
  ...rest
}: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fallbackCandidatesRef = useRef(fallbackCandidates);
  fallbackCandidatesRef.current = fallbackCandidates;
  const listboxId = useId();
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [candidates, setCandidates] = useState<MentionCandidate[]>(EMPTY_CANDIDATES);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  const open = Boolean(trigger);

  useEffect(() => {
    if (!trigger) {
      setCandidates((prev) => (prev.length === 0 ? prev : EMPTY_CANDIDATES));
      return;
    }
    if (!ticketId) {
      const q = trigger.query.toLowerCase();
      setCandidates(
        fallbackCandidatesRef.current
          .filter((c) => !q || c.name.toLowerCase().includes(q))
          .slice(0, 10)
      );
      setActiveIndex(0);
      return;
    }

    let cancelled = false;
    setLoading(true);
    apiFetchJson(
      `/api/tickets/${ticketId}/mentionable?q=${encodeURIComponent(trigger.query)}`
    )
      .then((d: { users?: MentionCandidate[] }) => {
        if (cancelled) return;
        setCandidates((d.users || []).slice(0, 10));
        setActiveIndex(0);
      })
      .catch(() => {
        if (!cancelled) setCandidates(EMPTY_CANDIDATES);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [trigger, ticketId]);

  const insertMention = useCallback(
    (candidate: MentionCandidate) => {
      if (!trigger) return;
      const el = textareaRef.current;
      const caret = el?.selectionStart ?? value.length;
      const token = `@[${candidate.name}](mention:${candidate.id}) `;
      const nextValue = value.slice(0, trigger.start) + token + value.slice(caret);
      onChange(nextValue);
      setTrigger(null);

      requestAnimationFrame(() => {
        if (textareaRef.current) {
          const nextPos = trigger.start + token.length;
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(nextPos, nextPos);
        }
      });
    },
    [trigger, value, onChange]
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextVal = e.target.value;
    const caret = e.target.selectionStart ?? nextVal.length;
    onChange(nextVal);
    onTyping?.();
    setTrigger(findActiveAtTrigger(nextVal, caret));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && candidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % candidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const chosen = candidates[activeIndex] || candidates[0];
        if (chosen) insertMention(chosen);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setTrigger(null);
        return;
      }
    } else if (open && e.key === "Escape") {
      e.preventDefault();
      setTrigger(null);
      return;
    }

    onKeyDown?.(e);
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open && candidates[activeIndex]
            ? `${listboxId}-opt-${candidates[activeIndex].id}`
            : undefined
        }
        className={className}
        {...rest}
      />

      {open && (
        <Surface
          variant="popover"
          id={listboxId}
          role="listbox"
          aria-label="Mentionable team members"
          data-testid="mention-picker"
          className="absolute left-0 bottom-full z-50 mb-1 max-h-48 w-64 overflow-y-auto rounded-lg border border-[var(--pw-border)] bg-[var(--pw-surface)] p-1 shadow-[var(--pw-shadow)]"
        >
          {loading && candidates.length === 0 ? (
            <div className="space-y-1 p-1" aria-busy="true" aria-label="Loading mentionable members">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-2 rounded px-1.5 py-1.5">
                  <SkeletonCircle size={20} />
                  <Skeleton className="h-3" style={{ width: `${52 + i * 14}%` }} />
                </div>
              ))}
            </div>
          ) : candidates.length === 0 ? (
            <div className="px-2.5 py-2 text-xs text-[var(--pw-ink-muted)]">
              No matching members with access
            </div>
          ) : (
            candidates.map((c, idx) => {
              const active = idx === activeIndex;
              return (
                <button
                  key={c.id}
                  id={`${listboxId}-opt-${c.id}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(c);
                  }}
                  className={`flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs transition ${
                    active
                      ? "bg-[var(--pw-accent-soft)] text-[var(--pw-accent)] font-medium"
                      : "text-[var(--pw-ink)] hover:bg-[var(--pw-surface-hover)]"
                  }`}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--pw-surface-muted)] font-mono text-[10px] font-semibold">
                    {c.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="truncate">{c.name}</span>
                </button>
              );
            })
          )}
        </Surface>
      )}
    </div>
  );
}
