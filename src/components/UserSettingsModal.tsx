"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Keyboard, Moon, RotateCcw, Sun, X } from "lucide-react";
import { Presence, Scale } from "@/components/ui/motion";
import { buildDate, displayVersion } from "@/lib/version";
import {
  getReduceMotionPreference,
  setReduceMotionPreference,
} from "@/lib/motion";
import {
  SHORTCUT_DEFINITIONS,
  detectShortcutConflict,
  eventToShortcutCombo,
  formatShortcut,
  type ShortcutActionId,
  type ShortcutMap,
} from "@/lib/shortcuts";

interface UserSettingsModalProps {
  open: boolean;
  onClose: () => void;
  user: { id: string; name: string; email: string };
  darkMode: boolean;
  onToggleTheme: () => void;
  shortcuts: ShortcutMap;
  onUpdateShortcut: (actionId: ShortcutActionId, combo: string) => void;
  onResetShortcuts: () => void;
}

export function UserSettingsModal({
  open,
  onClose,
  user,
  darkMode,
  onToggleTheme,
  shortcuts,
  onUpdateShortcut,
  onResetShortcuts,
}: UserSettingsModalProps) {
  const [recordingId, setRecordingId] = useState<ShortcutActionId | null>(null);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [reduceMotionPref, setReduceMotionPref] = useState<boolean>(() =>
    getReduceMotionPreference()
  );

  useEffect(() => {
    if (open) {
      setReduceMotionPref(getReduceMotionPreference());
    }
  }, [open]);

  const handleToggleReduceMotion = () => {
    const next = !reduceMotionPref;
    setReduceMotionPref(next);
    setReduceMotionPreference(next);
  };

  return (
    <Presence show={open} duration="base">
      {(phase) => (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 transition-opacity"
          style={{ opacity: phase === "entered" ? 1 : 0 }}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <Scale show={phase === "entered"} duration="base" className="w-full max-w-lg">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="User Preferences & Keyboard Shortcuts"
              data-testid="user-settings-modal"
              className="w-full rounded-xl border border-[var(--pw-border)] bg-[var(--pw-surface)] p-5 shadow-[var(--pw-shadow)]"
            >
        <div className="mb-4 flex items-center justify-between border-b border-[var(--pw-border)] pb-3">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-[var(--pw-accent)]" />
            <h2 className="text-sm font-semibold text-[var(--pw-ink)]">
              Preferences & Keyboard Shortcuts
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preferences"
            className="rounded p-1 text-[var(--pw-ink-muted)] hover:bg-[var(--pw-surface-hover)] hover:text-[var(--pw-ink)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[var(--pw-ink)] truncate">
                {user.name}
              </div>
              <div className="font-mono text-[11px] text-[var(--pw-ink-muted)] truncate">
                {user.email}
              </div>
            </div>
            <button
              type="button"
              onClick={onToggleTheme}
              className="flex items-center gap-1.5 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--pw-ink)] hover:bg-[var(--pw-surface-hover)]"
            >
              {darkMode ? (
                <>
                  <Sun className="h-3.5 w-3.5" />
                  <span>Light</span>
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5" />
                  <span>Dark</span>
                </>
              )}
            </button>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2.5">
            <div className="min-w-0 pr-3">
              <div className="text-xs font-semibold text-[var(--pw-ink)]">
                Reduce motion
              </div>
              <div className="text-[11px] text-[var(--pw-ink-muted)]">
                Disable sliding, scaling, and shimmer animations across Patchwork.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={reduceMotionPref}
              aria-label="Reduce motion"
              data-testid="reduce-motion-toggle"
              onClick={handleToggleReduceMotion}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                reduceMotionPref
                  ? "border-[var(--pw-accent)] bg-[var(--pw-accent)]"
                  : "border-[var(--pw-border)] bg-[var(--pw-surface-muted)]"
              }`}
            >
              <span
                className="pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform"
                style={{
                  transform: reduceMotionPref ? "translateX(17px)" : "translateX(2px)",
                }}
              />
            </button>
          </div>

          {conflictMsg && (
            <div
              role="alert"
              className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500"
            >
              {conflictMsg}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--pw-ink-muted)]">
                Global Shortcuts (click to rebind)
              </span>
              <button
                type="button"
                data-testid="reset-shortcuts-btn"
                onClick={() => {
                  setConflictMsg(null);
                  setRecordingId(null);
                  onResetShortcuts();
                }}
                className="flex items-center gap-1 text-[11px] text-[var(--pw-ink-secondary)] hover:text-[var(--pw-ink)]"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reset defaults</span>
              </button>
            </div>

            <div className="divide-y divide-[var(--pw-border)] rounded-lg border border-[var(--pw-border)] bg-[var(--pw-bg)]">
              {SHORTCUT_DEFINITIONS.map((def) => {
                const isRecording = recordingId === def.id;
                const currentCombo = shortcuts[def.id];
                return (
                  <div
                    key={def.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[var(--pw-ink)]">
                        {def.label}
                      </div>
                      <div className="text-[11px] text-[var(--pw-ink-muted)]">
                        {def.description}
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid={`shortcut-rebind-${def.id}`}
                      onClick={() => {
                        setConflictMsg(null);
                        setRecordingId(isRecording ? null : def.id);
                      }}
                      onKeyDown={(e) => {
                        if (!isRecording) return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.key === "Escape") {
                          setRecordingId(null);
                          return;
                        }
                        const combo = eventToShortcutCombo(e);
                        if (!combo) return;
                        const conflict = detectShortcutConflict(def.id, combo, shortcuts);
                        if (conflict) {
                          const conflictDef = SHORTCUT_DEFINITIONS.find((d) => d.id === conflict);
                          setConflictMsg(
                            `"${formatShortcut(combo)}" is already bound to "${conflictDef?.label || conflict}".`
                          );
                          return;
                        }
                        setConflictMsg(null);
                        onUpdateShortcut(def.id, combo);
                        setRecordingId(null);
                      }}
                      className={`shrink-0 rounded border px-2.5 py-1 font-mono text-xs transition ${
                        isRecording
                          ? "border-[var(--pw-accent)] bg-[var(--pw-accent-soft)] text-[var(--pw-accent)]"
                          : "border-[var(--pw-border)] bg-[var(--pw-surface)] text-[var(--pw-ink)] hover:border-[var(--pw-accent)]"
                      }`}
                    >
                      {isRecording ? "Press keys..." : formatShortcut(currentCombo)}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            data-testid="about-patchwork-section"
            className="rounded-lg border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2.5 flex items-center justify-between gap-3 text-xs"
          >
            <div className="min-w-0">
              <div className="font-semibold text-[var(--pw-ink)]">
                About Patchwork
              </div>
              <div className="text-[11px] text-[var(--pw-ink-muted)] font-mono">
                <span data-testid="about-version">{displayVersion}</span>
                <span> · Built {buildDate}</span>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0 text-[11px]">
              <Link
                href="/documentation/project/changelog/"
                className="font-medium text-[var(--pw-accent)] hover:underline"
              >
                Changelog
              </Link>
              <Link
                href="/documentation"
                className="font-medium text-[var(--pw-accent)] hover:underline"
              >
                Documentation
              </Link>
            </div>
          </div>
        </div>
            </div>
          </Scale>
        </div>
      )}
    </Presence>
  );
}

