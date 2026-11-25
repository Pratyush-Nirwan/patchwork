"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  BellOff,
  Check,
  MailOpen,
  RefreshCw,
  X,
} from "lucide-react";
import { apiFetchJson } from "@/lib/api-client";
import {
  MOTION_DURATIONS,
  MOTION_EASINGS,
  useAntiFlashLoading,
  useReducedMotion,
} from "@/lib/motion";
import { Fade } from "@/components/ui/motion";
import { Skeleton, SkeletonCircle, Surface } from "@/components/ui/skeleton";
import type { NotificationTab, NotificationViewItem } from "@/lib/notifications";

function getCsrfFromCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(/(?:^|;\s*)patchwork_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "just now";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatHeadline(n: NotificationViewItem): string {
  if (n.redacted) return "You no longer have access to this ticket";
  const actor = n.actorName || "Someone";
  const key = n.ticketKey || "a ticket";
  if (n.type === "mention") return `${actor} mentioned you in ${key}`;
  if (n.type === "assignment") return `${actor} assigned ${key} to you`;
  if (n.type === "unassignment") return `${actor} unassigned you from ${key}`;
  if (n.count > 1) return `${actor} (+${n.count - 1} updates) on ${key}`;
  return `${actor} ${n.eventKind} on ${key}`;
}

export function broadcastNotificationSync(action: { type: string }) {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  try {
    const ch = new BroadcastChannel("patchwork_notifications");
    ch.postMessage(action);
    ch.close();
  } catch {
    // ignore
  }
}

export function NotificationInbox({
  compact = false,
  refreshSignal = 0,
  onUnreadCountChange,
  onOpenTicket,
  onClose,
}: {
  compact?: boolean;
  refreshSignal?: number;
  onUnreadCountChange?: (count: number) => void;
  onOpenTicket?: (ticketId: string, commentId?: string | null) => void;
  onClose?: () => void;
}) {
  const [tab, setTab] = useState<NotificationTab>("all");
  const [items, setItems] = useState<NotificationViewItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const hasLoadedOnceRef = useRef(false);
  const reduced = useReducedMotion();
  const showSkeleton = useAntiFlashLoading(loading && items.length === 0, 150, 300);
  const revalidating = loading && items.length > 0;

  const fetchPage = useCallback(
    async (
      selectedTab: NotificationTab,
      cursor?: string | null,
      append = false,
      silent = false
    ) => {
      if (append) setLoadingMore(true);
      else if (!silent) setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          tab: selectedTab,
          limit: compact ? "20" : "30",
        });
        if (cursor) params.set("cursor", cursor);
        const data = (await apiFetchJson(`/api/notifications?${params.toString()}`)) as {
          items: NotificationViewItem[];
          unreadCount: number;
          nextCursor: string | null;
        };
        hasLoadedOnceRef.current = true;
        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setNextCursor(data.nextCursor);
        onUnreadCountChange?.(data.unreadCount);
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : "Failed to load notifications");
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [compact, onUnreadCountChange]
  );

  useEffect(() => {
    hasLoadedOnceRef.current = false;
    fetchPage(tab, null, false, false);
  }, [tab, fetchPage]);

  useEffect(() => {
    if (refreshSignal > 0) {
      fetchPage(tab, null, false, hasLoadedOnceRef.current);
    }
  }, [refreshSignal, tab, fetchPage]);

  // Infinite scroll observer
  useEffect(() => {
    if (!nextCursor || loadingMore || !sentinelRef.current) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && nextCursor && !loadingMore) {
          fetchPage(tab, nextCursor, true);
        }
      },
      { threshold: 0.1 }
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [nextCursor, loadingMore, tab, fetchPage]);

  const handleMarkRead = async (n: NotificationViewItem, read: boolean) => {
    await apiFetchJson(
      `/api/notifications/${n.id}`,
      { method: "PATCH", body: JSON.stringify({ read }) },
      { csrfToken: getCsrfFromCookie() }
    );
    setItems((prev) =>
      prev
        .map((item) =>
          item.id === n.id ? { ...item, readAt: read ? new Date().toISOString() : null } : item
        )
        .filter((item) => (tab === "unread" ? !item.readAt : true))
    );
    broadcastNotificationSync({ type: "refresh" });
    fetchPage(tab, null, false, true);
  };

  const handleArchive = async (n: NotificationViewItem, archive = true) => {
    await apiFetchJson(
      `/api/notifications/${n.id}`,
      { method: "PATCH", body: JSON.stringify({ archive }) },
      { csrfToken: getCsrfFromCookie() }
    );
    setItems((prev) => prev.filter((item) => item.id !== n.id));
    broadcastNotificationSync({ type: "refresh" });
    fetchPage(tab, null, false, true);
  };

  const handleMuteTicket = async (n: NotificationViewItem) => {
    if (n.redacted) return;
    const nextMuted = !n.ticketMuted;
    await apiFetchJson(
      `/api/tickets/${n.ticketId}/watch`,
      { method: "POST", body: JSON.stringify({ muted: nextMuted }) },
      { csrfToken: getCsrfFromCookie() }
    );
    setItems((prev) =>
      prev.map((item) =>
        item.ticketId === n.ticketId ? { ...item, ticketMuted: nextMuted } : item
      )
    );
  };

  const handleOpen = async (n: NotificationViewItem) => {
    if (!n.readAt) {
      await handleMarkRead(n, true).catch(() => undefined);
    }
    if (n.redacted) return;
    if (onOpenTicket) {
      onOpenTicket(n.ticketId, n.commentId);
    } else if (typeof window !== "undefined") {
      const qs = new URLSearchParams({ ticket: n.ticketId });
      if (n.commentId) qs.set("comment", n.commentId);
      window.location.assign(`/?${qs.toString()}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return;
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(items.length - 1, focusedIdx + 1);
      setFocusedIdx(next);
      rowRefs.current[next]?.focus();
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = Math.max(0, focusedIdx - 1);
      setFocusedIdx(prev);
      rowRefs.current[prev]?.focus();
    } else if (e.key === "Enter" && items[focusedIdx]) {
      e.preventDefault();
      handleOpen(items[focusedIdx]);
    }
  };

  const tabs: Array<{ id: NotificationTab; label: string }> = [
    { id: "all", label: "All" },
    { id: "unread", label: "Unread" },
    { id: "mentions", label: "Mentions" },
    { id: "assigned", label: "Assigned" },
    { id: "watching", label: "Watching" },
    { id: "archived", label: "Archived" },
  ];

  return (
    <Surface
      variant="popover"
      className="flex flex-col"
      onKeyDown={handleKeyDown}
      data-testid="notification-inbox"
    >
      <div className="flex items-center justify-between gap-1.5 border-b border-[var(--pw-border)] px-2.5 py-2">
        <div role="tablist" aria-label="Notification filters" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 rounded px-1.5 py-1 min-h-[36px] sm:min-h-[28px] text-xs font-medium ${tab === t.id
                ? "bg-[var(--pw-accent)] text-white"
                : "text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-hover)] hover:text-[var(--pw-ink)]"
                }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {onClose && (
          <button
            type="button"
            aria-label="Close notifications"
            data-testid="close-notifications-btn"
            onClick={onClose}
            className={`inline-flex shrink-0 min-h-[36px] min-w-[36px] sm:min-h-[28px] sm:min-w-[28px] items-center justify-center rounded p-1 text-[var(--pw-ink-muted)] hover:bg-[var(--pw-surface-hover)] hover:text-[var(--pw-ink)] ${reduced ? "" : "transition-transform duration-[120ms] active:scale-95"}`}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {loading && items.length === 0 ? (
        showSkeleton ? (
          <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading notifications">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-start gap-2.5 rounded border border-[var(--pw-border)] p-2.5">
                <SkeletonCircle size={28} />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="min-h-[160px]" aria-busy="true" aria-label="Loading notifications" />
        )
      ) : error ? (
        <Fade duration="fast">
          <div className="p-6 text-center space-y-2">
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            <button
              type="button"
              onClick={() => fetchPage(tab, null, false)}
              className="inline-flex items-center gap-1 rounded border border-[var(--pw-border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--pw-surface-hover)]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Retry</span>
            </button>
          </div>
        </Fade>
      ) : !loading && items.length === 0 ? (
        <Fade duration="fast">
          <div className="p-8 text-center">
            <p className="text-xs font-medium text-[var(--pw-ink)]">All caught up</p>
            <p className="mt-1 text-[11px] text-[var(--pw-ink-muted)]">
              No {tab === "all" ? "" : `${tab} `}notifications right now.
            </p>
          </div>
        </Fade>
      ) : items.length > 0 ? (
        <div
          style={{
            opacity: revalidating ? 0.6 : 1,
            transitionProperty: "opacity",
            transitionDuration: `${reduced ? 0 : MOTION_DURATIONS.fast}ms`,
            transitionTimingFunction: MOTION_EASINGS.out,
          }}
          className={compact ? "max-h-[60vh] overflow-y-auto divide-y divide-[var(--pw-border)]" : "divide-y divide-[var(--pw-border)]"}
        >
          {items.map((n, idx) => {
            const unread = !n.readAt;
            return (
              <div
                key={n.id}
                ref={(el) => {
                  rowRefs.current[idx] = el;
                }}
                tabIndex={0}
                data-testid={`notification-row-${n.id}`}
                onFocus={() => setFocusedIdx(idx)}
                className={`group flex items-start gap-2.5 px-3 py-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--pw-accent)] ${unread
                  ? "border-l-2 border-l-[var(--pw-accent)] bg-[var(--pw-accent-soft)]/30"
                  : "hover:bg-[var(--pw-surface-hover)]"
                  }`}
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--pw-surface-muted)] font-mono text-[10px] font-semibold text-[var(--pw-ink)]"
                >
                  {n.redacted ? "?" : (n.actorName || "SY").slice(0, 2).toUpperCase()}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpen(n)}
                      className={`cursor-pointer text-left hover:underline ${unread ? "font-semibold text-[var(--pw-ink)]" : "text-[var(--pw-ink)]"
                        }`}
                    >
                      {unread && (
                        <span
                          aria-label="Unread"
                          className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--pw-accent)] align-middle"
                        />
                      )}
                      {formatHeadline(n)}
                    </button>
                    <span
                      title={new Date(n.updatedAt).toLocaleString()}
                      className="shrink-0 text-[10px] text-[var(--pw-ink-muted)]"
                    >
                      {formatRelativeTime(n.updatedAt)}
                    </span>
                  </div>

                  {!n.redacted && (
                    <div className="mt-0.5 truncate text-[11px] text-[var(--pw-ink-secondary)]">
                      {n.ticketTitle}
                    </div>
                  )}

                  {!n.redacted && n.snippet && (
                    <p className="mt-1 line-clamp-2 rounded bg-[var(--pw-bg)] px-2 py-1 text-[11px] text-[var(--pw-ink-secondary)]">
                      {n.snippet}
                    </p>
                  )}

                  <div className="mt-1.5 flex items-center justify-end gap-1">
                    <button
                      type="button"
                      aria-label={unread ? "Mark read" : "Mark unread"}
                      title={unread ? "Mark read" : "Mark unread"}
                      onClick={() => handleMarkRead(n, unread)}
                      className={`inline-flex h-7 w-7 items-center justify-center rounded text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)] ${reduced ? "" : "transition-transform duration-[120ms] active:scale-95"}`}
                    >
                      {unread ? (
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <MailOpen className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                    {!n.redacted && (
                      <button
                        type="button"
                        aria-pressed={n.ticketMuted}
                        aria-label={n.ticketMuted ? "Unmute ticket" : "Mute ticket"}
                        title={n.ticketMuted ? "Muted (click to unmute)" : "Mute ticket"}
                        onClick={() => handleMuteTicket(n)}
                        className={`inline-flex h-7 w-7 items-center justify-center rounded ${reduced ? "" : "transition-transform duration-[120ms] active:scale-95"} ${n.ticketMuted
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                          : "text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)]"
                          }`}
                      >
                        <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={n.archivedAt ? "Unarchive" : "Archive"}
                      title={n.archivedAt ? "Unarchive" : "Archive"}
                      onClick={() => handleArchive(n, !n.archivedAt)}
                      className={`inline-flex h-7 w-7 items-center justify-center rounded text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)] ${reduced ? "" : "transition-transform duration-[120ms] active:scale-95"}`}
                    >
                      {n.archivedAt ? (
                        <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {loadingMore && (
            <div className="divide-y divide-[var(--pw-border)]" aria-busy="true" aria-label="Loading more notifications">
              {[0, 1].map((i) => (
                <div key={i} className="flex items-start gap-2.5 px-3 py-2.5">
                  <SkeletonCircle size={28} />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {nextCursor && !loadingMore && (
            <div ref={sentinelRef} className="p-3 text-center">
              <button
                type="button"
                onClick={() => fetchPage(tab, nextCursor, true)}
                className="rounded border border-[var(--pw-border)] px-3 py-1 text-xs font-medium text-[var(--pw-ink)] hover:bg-[var(--pw-surface-hover)]"
              >
                Load more
              </button>
            </div>
          )}
        </div>
      ) : null}
    </Surface>
  );
}
