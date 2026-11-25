"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/motion";

export interface PresencePerson {
  userId: string;
  name: string;
}

export interface RoomPresenceState {
  viewers: PresencePerson[];
  typers: PresencePerson[];
}

function getCsrfFromCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(/(?:^|;\s*)patchwork_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export function useTicketPresence(ticketId: string | null) {
  const [presence, setPresence] = useState<RoomPresenceState>({
    viewers: [],
    typers: [],
  });
  const tabIdRef = useRef<string>(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const lastTypingSentRef = useRef(0);

  const sendState = useCallback(
    async (state: "view" | "typing" | "leave", useBeacon = false) => {
      if (!ticketId) return;
      const url = `/api/tickets/${ticketId}/presence`;
      const payload = JSON.stringify({ state, tabId: tabIdRef.current });
      if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
        return;
      }
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const csrf = getCsrfFromCookie();
      if (csrf) headers["x-csrf-token"] = csrf;
      await fetch(url, {
        method: "POST",
        headers,
        body: payload,
        keepalive: state === "leave",
      }).catch(() => undefined);
    },
    [ticketId]
  );

  const notifyTyping = useCallback(() => {
    if (!ticketId || (typeof document !== "undefined" && document.hidden)) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 3000) return;
    lastTypingSentRef.current = now;
    void sendState("typing");
  }, [ticketId, sendState]);

  useEffect(() => {
    if (!ticketId) {
      setPresence({ viewers: [], typers: [] });
      return;
    }

    let es: EventSource | null = null;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      es = new EventSource(`/api/tickets/${ticketId}/presence/stream`);
      es.addEventListener("presence", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as RoomPresenceState;
          const nextViewers = Array.isArray(data.viewers) ? data.viewers : [];
          const nextTypers = Array.isArray(data.typers) ? data.typers : [];
          setPresence((prev) => {
            const sameViewers =
              prev.viewers.length === nextViewers.length &&
              prev.viewers.every(
                (v, i) => v.userId === nextViewers[i]?.userId && v.name === nextViewers[i]?.name
              );
            const sameTypers =
              prev.typers.length === nextTypers.length &&
              prev.typers.every(
                (t, i) => t.userId === nextTypers[i]?.userId && t.name === nextTypers[i]?.name
              );
            if (sameViewers && sameTypers) return prev;
            return { viewers: nextViewers, typers: nextTypers };
          });
        } catch {
          // ignore
        }
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
    if (typeof document === "undefined" || !document.hidden) {
      void sendState("view");
    }

    const heartbeat = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) {
        void sendState("view");
      }
    }, 15_000);

    const onVisibility = () => {
      if (!document.hidden) {
        void sendState("view");
      }
    };
    const onUnload = () => {
      void sendState("leave", true);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onUnload);
    window.addEventListener("beforeunload", onUnload);

    return () => {
      closed = true;
      clearInterval(heartbeat);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onUnload);
      window.removeEventListener("beforeunload", onUnload);
      es?.close();
      void sendState("leave", true);
    };
  }, [ticketId, sendState]);

  return { presence, notifyTyping };
}

export function TicketViewerAvatars({
  viewers,
  currentUserId,
}: {
  viewers: PresencePerson[];
  currentUserId: string;
}) {
  const others = useMemo(
    () => viewers.filter((v) => v.userId !== currentUserId),
    [viewers, currentUserId]
  );
  const reducedMotion = useReducedMotion();
  const motionAllowed = !reducedMotion;

  if (others.length === 0) {
    return <div className="h-6" aria-hidden="true" />;
  }

  const visible = others.slice(0, 5);
  const extra = others.length - visible.length;
  const namesLabel = `${others.length} ${others.length === 1 ? "person" : "people"} viewing this ticket: ${others
    .map((o) => o.name)
    .join(", ")}`;

  return (
    <div
      data-testid="presence-viewer-stack"
      aria-label={namesLabel}
      title={namesLabel}
      className="flex h-6 items-center -space-x-1.5"
    >
      {visible.map((v) => (
        <span
          key={v.userId}
          title={v.name}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--pw-surface)] bg-[var(--pw-accent-soft)] font-mono text-[10px] font-semibold text-[var(--pw-accent)] ${
            motionAllowed ? "transition-opacity duration-150" : ""
          }`}
        >
          {v.name.slice(0, 2).toUpperCase()}
        </span>
      ))}
      {extra > 0 && (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--pw-surface)] bg-[var(--pw-surface-muted)] font-mono text-[10px] font-semibold text-[var(--pw-ink-secondary)]">
          +{extra}
        </span>
      )}
    </div>
  );
}

export function TicketTypingIndicator({
  typers,
  currentUserId,
}: {
  typers: PresencePerson[];
  currentUserId: string;
}) {
  const others = useMemo(
    () => typers.filter((t) => t.userId !== currentUserId),
    [typers, currentUserId]
  );

  const text = useMemo(() => {
    if (others.length === 0) return "";
    if (others.length === 1) return `${others[0].name} is typing…`;
    if (others.length === 2) return `${others[0].name} and ${others[1].name} are typing…`;
    return `${others[0].name} and ${others.length - 1} others are typing…`;
  }, [others]);

  return (
    <div
      data-testid="typing-indicator"
      aria-live="polite"
      className="h-4 text-[11px] italic text-[var(--pw-ink-muted)]"
    >
      {text}
    </div>
  );
}
