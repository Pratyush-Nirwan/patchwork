"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Eye, EyeOff } from "lucide-react";
import { apiFetchJson } from "@/lib/api-client";
import { MOTION_DURATIONS, MOTION_EASINGS, useReducedMotion } from "@/lib/motion";
import { Presence } from "@/components/ui/motion";
import { Skeleton, SkeletonCircle, Surface } from "@/components/ui/skeleton";

function getCsrfFromCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(/(?:^|;\s*)patchwork_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export interface TicketWatcherItem {
  userId: string;
  name: string;
  source: string;
  muted: boolean;
}

export interface TicketWatchStatus {
  watching: boolean;
  muted: boolean;
  watcherCount: number;
  watchers: TicketWatcherItem[];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function TicketWatcherControls({
  ticketId,
  initialStatus,
  onStatusChange,
}: {
  ticketId: string;
  initialStatus?: TicketWatchStatus;
  onStatusChange?: (next: TicketWatchStatus) => void;
}) {
  const [status, setStatus] = useState<TicketWatchStatus>(
    initialStatus ?? {
      watching: false,
      muted: false,
      watcherCount: 0,
      watchers: [],
    }
  );
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (initialStatus) {
      setStatus(initialStatus);
      setHasMore(initialStatus.watcherCount > initialStatus.watchers.length);
    }
  }, [initialStatus]);

  useEffect(() => {
    if (!popoverOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEsc, true);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEsc, true);
    };
  }, [popoverOpen]);

  const applyStatus = useCallback(
    (next: TicketWatchStatus) => {
      setStatus(next);
      setHasMore(next.watcherCount > next.watchers.length);
      onStatusChange?.(next);
    },
    [onStatusChange]
  );

  const handleToggleWatch = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = (await apiFetchJson(
        `/api/tickets/${ticketId}/watch`,
        { method: status.watching ? "DELETE" : "POST" },
        { csrfToken: getCsrfFromCookie() }
      )) as TicketWatchStatus;
      applyStatus(next);
    } finally {
      setBusy(false);
    }
  };

  const handleLoadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const page = (await apiFetchJson(
        `/api/tickets/${ticketId}/watch?limit=20&offset=${status.watchers.length}`
      )) as {
        watchers: TicketWatcherItem[];
        totalCount: number;
        hasMore: boolean;
      };
      setStatus((prev) => ({
        ...prev,
        watcherCount: page.totalCount,
        watchers: [...prev.watchers, ...page.watchers],
      }));
      setHasMore(page.hasMore);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div ref={containerRef} className="relative flex items-center">
      <div
        className={`inline-flex items-stretch overflow-hidden rounded border ${
          status.watching
            ? "border-[var(--pw-accent)] bg-[var(--pw-accent-soft)] text-[var(--pw-accent)]"
            : "border-[var(--pw-border)] bg-[var(--pw-bg)] text-[var(--pw-ink-secondary)]"
        }`}
      >
        <button
          type="button"
          data-testid="ticket-watch-toggle"
          disabled={busy}
          onClick={handleToggleWatch}
          aria-pressed={status.watching}
          aria-label={status.watching ? "Stop watching ticket" : "Watch ticket"}
          title={status.watching ? "Watching (click to stop watching)" : "Watch ticket"}
          className={`inline-flex min-h-[44px] sm:min-h-[30px] items-center justify-center px-2 py-1 text-xs font-medium ${
            status.watching
              ? "hover:bg-[var(--pw-accent)]/10"
              : "hover:bg-[var(--pw-surface-hover)] hover:text-[var(--pw-ink)]"
          }`}
        >
          {status.watching ? (
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          data-testid="ticket-watchers-count-btn"
          aria-expanded={popoverOpen}
          aria-label={`${status.watcherCount} watcher${status.watcherCount === 1 ? "" : "s"}`}
          onClick={() => setPopoverOpen((v) => !v)}
          className={`inline-flex min-h-[44px] sm:min-h-[30px] items-center gap-1 border-l px-2 py-1 font-mono text-xs tabular-nums ${
            status.watching
              ? "border-[var(--pw-accent)]/30 hover:bg-[var(--pw-accent)]/10"
              : "border-[var(--pw-border)] hover:bg-[var(--pw-surface-hover)] hover:text-[var(--pw-ink)]"
          }`}
        >
          <span>{status.watcherCount}</span>
          <ChevronDown
            className={`h-3 w-3 ${popoverOpen ? "rotate-180" : ""} ${reduced ? "" : "transition-transform duration-[120ms]"}`}
            aria-hidden="true"
          />
        </button>
      </div>

      <Presence show={popoverOpen} duration="base">
        {(phase) => {
          const visible = phase === "entered";
          return (
            <Surface
              variant="popover"
              role="region"
              aria-label="Ticket watchers"
              data-testid="ticket-watchers-popover"
              style={{
                opacity: visible ? 1 : 0,
                transform: reduced
                  ? "none"
                  : visible
                    ? "translate3d(0, 0, 0) scale(1)"
                    : "translate3d(0, -6px, 0) scale(0.97)",
                transitionProperty: reduced ? "opacity" : "transform, opacity",
                transitionDuration: `${reduced ? 0 : MOTION_DURATIONS.base}ms`,
                transitionTimingFunction: visible ? MOTION_EASINGS.out : MOTION_EASINGS.in,
              }}
              className="absolute right-0 top-full z-40 mt-1.5 w-64 origin-top-right rounded-lg border border-[var(--pw-border)] bg-[var(--pw-surface)] p-3 shadow-[var(--pw-shadow)]"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--pw-ink)]">
                  Watchers ({status.watcherCount})
                </span>
              </div>
              {status.watchers.length === 0 ? (
                <p className="text-xs text-[var(--pw-ink-muted)]">No one is watching this ticket yet.</p>
              ) : (
                <ul className="max-h-56 space-y-1.5 overflow-y-auto">
                  {status.watchers.map((w) => (
                    <li
                      key={w.userId}
                      className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-xs"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--pw-accent-soft)] font-mono text-[10px] font-semibold text-[var(--pw-accent)]"
                        >
                          {getInitials(w.name)}
                        </span>
                        <span className="truncate text-[var(--pw-ink)]">{w.name}</span>
                      </div>
                      {w.muted && (
                        <span className="shrink-0 text-[10px] text-[var(--pw-ink-muted)]">muted</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {loadingMore && (
                <div className="mt-1.5 space-y-1.5" aria-busy="true" aria-label="Loading more watchers">
                  {[0, 1].map((i) => (
                    <div key={i} className="flex items-center gap-2 px-1.5 py-1">
                      <SkeletonCircle size={24} />
                      <Skeleton className="h-3 w-28" />
                    </div>
                  ))}
                </div>
              )}
              {hasMore && !loadingMore && (
                <button
                  type="button"
                  onClick={handleLoadMore}
                  className="mt-2 w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] py-1.5 text-xs font-medium text-[var(--pw-ink)] hover:bg-[var(--pw-surface-hover)]"
                >
                  Load more
                </button>
              )}
            </Surface>
          );
        }}
      </Presence>
    </div>
  );
}
