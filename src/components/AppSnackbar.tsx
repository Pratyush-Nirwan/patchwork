"use client";

import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { Presence, Slide } from "@/components/ui/motion";
import { useReducedMotion } from "@/lib/motion";

export interface SnackbarState {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}

interface AppSnackbarProps {
  snackbar: SnackbarState | null;
  onDismiss: () => void;
}

const SNACKBAR_DURATION_MS = 5000;

export function AppSnackbar({ snackbar, onDismiss }: AppSnackbarProps) {
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [progressKey, setProgressKey] = useState(0);
  const pointerStartXRef = useRef<number | null>(null);
  const lastSnackbarRef = useRef<SnackbarState | null>(snackbar);
  const remainingRef = useRef(SNACKBAR_DURATION_MS);
  const startedAtRef = useRef<number>(Date.now());

  if (snackbar) {
    lastSnackbarRef.current = snackbar;
  }

  useEffect(() => {
    if (!snackbar) {
      remainingRef.current = SNACKBAR_DURATION_MS;
      setDragX(0);
      return;
    }
    remainingRef.current = SNACKBAR_DURATION_MS;
    setDragX(0);
    setPaused(false);
    setProgressKey((k) => k + 1);
  }, [snackbar]);

  useEffect(() => {
    if (!snackbar || paused) return;
    startedAtRef.current = Date.now();
    const timer = window.setTimeout(() => {
      onDismiss();
    }, remainingRef.current);
    return () => {
      window.clearTimeout(timer);
      const elapsed = Date.now() - startedAtRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    };
  }, [snackbar, paused, onDismiss]);

  const active = snackbar || lastSnackbarRef.current;

  return (
    <Presence show={Boolean(snackbar)} duration="base">
      {(phase) =>
        active ? (
          <div className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+16px)] left-1/2 z-50 w-max max-w-[calc(100vw-24px)] -translate-x-1/2 sm:bottom-5">
            <Slide show={phase === "entered"} direction="up" distance="sm" duration="base">
              <div
                role="status"
                aria-live="polite"
                data-testid="app-snackbar"
                onMouseEnter={() => setPaused(true)}
                onMouseLeave={() => setPaused(false)}
                onFocusCapture={() => setPaused(true)}
                onBlurCapture={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setPaused(false);
                  }
                }}
                onPointerDown={(e) => {
                  pointerStartXRef.current = e.clientX;
                  setPaused(true);
                }}
                onPointerMove={(e) => {
                  if (pointerStartXRef.current === null) return;
                  setDragX(e.clientX - pointerStartXRef.current);
                }}
                onPointerUp={() => {
                  if (Math.abs(dragX) > 72) {
                    onDismiss();
                  }
                  pointerStartXRef.current = null;
                  setDragX(0);
                  setPaused(false);
                }}
                onPointerCancel={() => {
                  pointerStartXRef.current = null;
                  setDragX(0);
                  setPaused(false);
                }}
                style={{
                  transform: dragX !== 0 && !reduced ? `translate3d(${dragX}px, 0, 0)` : undefined,
                  opacity: dragX !== 0 ? Math.max(0.25, 1 - Math.abs(dragX) / 160) : undefined,
                  touchAction: "pan-y",
                }}
                className="relative overflow-hidden flex items-center gap-2.5 rounded-lg border border-[var(--pw-border)] bg-[var(--pw-surface)] px-3.5 py-2 text-xs text-[var(--pw-ink)] shadow-[var(--pw-shadow)]"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span className="truncate font-medium" data-testid="app-snackbar-message">
                  {active.message}
                </span>
                {active.actionLabel && active.onAction && (
                  <button
                    type="button"
                    data-testid="app-snackbar-action"
                    onClick={async () => {
                      const fn = active.onAction;
                      onDismiss();
                      if (fn) await fn();
                    }}
                    className="min-h-[36px] sm:min-h-0 shrink-0 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1 font-semibold text-[var(--pw-accent)] hover:bg-[var(--pw-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--pw-accent)]"
                  >
                    {active.actionLabel}
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  data-testid="app-snackbar-dismiss"
                  onClick={onDismiss}
                  className="min-h-[36px] min-w-[36px] sm:min-h-0 sm:min-w-0 inline-flex shrink-0 items-center justify-center rounded p-1 text-[var(--pw-ink-muted)] hover:bg-[var(--pw-surface-hover)] hover:text-[var(--pw-ink)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                {!reduced && (
                  <div
                    key={progressKey}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] origin-left bg-[var(--pw-accent)]/60"
                    style={{
                      animation: `pw-snackbar-countdown ${SNACKBAR_DURATION_MS}ms linear forwards`,
                      animationPlayState: paused ? "paused" : "running",
                    }}
                  />
                )}
              </div>
            </Slide>
          </div>
        ) : null
      }
    </Presence>
  );
}

