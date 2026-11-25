"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { apiFetchJson } from "@/lib/api-client";
import { MOTION_DURATIONS, MOTION_EASINGS, useReducedMotion } from "@/lib/motion";
import { Presence, RegionErrorBoundary } from "@/components/ui/motion";
import { NotificationInbox } from "./NotificationInbox";

export function NotificationBell({
  onOpenTicket,
}: {
  onOpenTicket?: (ticketId: string, commentId?: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const lastAnnouncedAtRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const fetchUnreadCount = useCallback(async () => {
    try {
      const data = (await apiFetchJson("/api/notifications?tab=unread&limit=1")) as {
        unreadCount: number;
      };
      setUnreadCount(data.unreadCount);
    } catch {
      // ignore transient error
    }
  }, []);

  useEffect(() => {
    fetchUnreadCount();
    const onOpenCmd = () => setOpen(true);
    window.addEventListener("patchwork:open-notifications", onOpenCmd);
    return () => window.removeEventListener("patchwork:open-notifications", onOpenCmd);
  }, [fetchUnreadCount]);

  // Cross-tab BroadcastChannel sync
  useEffect(() => {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel("patchwork_notifications");
    ch.onmessage = () => {
      fetchUnreadCount();
      setRefreshSignal((s) => s + 1);
    };
    return () => ch.close();
  }, [fetchUnreadCount]);

  // Per-user SSE stream with silent reconnect & catch-up
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let hasConnectedOnce = false;

    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/notifications/stream");
      es.addEventListener("connected", () => {
        if (hasConnectedOnce) {
          // Silent catch-up on reconnect
          fetchUnreadCount();
          setRefreshSignal((s) => s + 1);
        }
        hasConnectedOnce = true;
      });
      es.addEventListener("notification", () => {
        fetchUnreadCount();
        setRefreshSignal((s) => s + 1);
        const now = Date.now();
        if (now - lastAnnouncedAtRef.current >= 10_000) {
          lastAnnouncedAtRef.current = now;
          setLiveAnnouncement("You have a new notification.");
        }
      });
      es.addEventListener("session_expired", () => {
        es?.close();
      });
      es.onerror = () => {
        es?.close();
        if (!closed && !reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 3000);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEsc, true);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEsc, true);
    };
  }, [open]);

  const badgeText = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <div ref={containerRef} className="relative">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>

      <button
        type="button"
        data-testid="notification-bell-btn"
        aria-expanded={open}
        aria-label={
          unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
        }
        onClick={() => setOpen((v) => !v)}
        className={`relative inline-flex min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px] items-center justify-center rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2 text-[var(--pw-ink)] hover:bg-[var(--pw-surface-hover)] ${reduced ? "" : "transition-transform duration-[120ms] active:scale-95"}`}
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            data-testid="notification-unread-badge"
            className="absolute -top-1.5 -right-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-[var(--pw-accent)] px-1 py-0.2 font-mono text-[10px] font-bold leading-tight text-white tabular-nums"
          >
            {badgeText}
          </span>
        )}
      </button>

      <Presence show={open} duration="base">
        {(phase) => {
          const visible = phase === "entered";
          return (
            <div
              role="dialog"
              aria-label="Notification inbox"
              data-testid="notification-popover"
              style={{
                opacity: visible ? 1 : 0,
                transform: reduced
                  ? "none"
                  : visible
                    ? "translate3d(0, 0, 0) scale(1)"
                    : "translate3d(0, -8px, 0) scale(0.97)",
                transitionProperty: reduced ? "opacity" : "transform, opacity",
                transitionDuration: `${reduced ? 0 : MOTION_DURATIONS.base}ms`,
                transitionTimingFunction: visible ? MOTION_EASINGS.out : MOTION_EASINGS.in,
              }}
              className="fixed inset-0 z-50 flex flex-col bg-[var(--pw-surface)] sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[440px] sm:rounded-xl sm:border sm:border-[var(--pw-border)] sm:shadow-[var(--pw-shadow)] sm:origin-top-right"
            >
              <RegionErrorBoundary regionName="Notifications">
                <NotificationInbox
                  compact
                  refreshSignal={refreshSignal}
                  onUnreadCountChange={setUnreadCount}
                  onClose={() => setOpen(false)}
                  onOpenTicket={(tid, cid) => {
                    setOpen(false);
                    onOpenTicket?.(tid, cid);
                  }}
                />
              </RegionErrorBoundary>
            </div>
          );
        }}
      </Presence>
    </div>
  );
}
