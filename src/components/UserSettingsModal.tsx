"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Keyboard, Moon, RotateCcw, Sun, X } from "lucide-react";
import { Presence, Scale } from "@/components/ui/motion";
import { Skeleton, SkeletonRegion, Surface } from "@/components/ui/skeleton";
import { apiFetchJson } from "@/lib/api-client";
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
  const [activeTab, setActiveTab] = useState<"general" | "notifications">("general");
  const [recordingId, setRecordingId] = useState<ShortcutActionId | null>(null);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [reduceMotionPref, setReduceMotionPref] = useState<boolean>(() =>
    getReduceMotionPreference()
  );
  const [notifPrefs, setNotifPrefs] = useState<{
    inAppMentions: boolean;
    inAppAssignments: boolean;
    inAppWatched: boolean;
    emailMentions: "off" | "immediate" | "digest";
    emailAssignments: "off" | "immediate" | "digest";
    emailWatched: "off" | "digest";
    digestFrequency: "daily" | "weekly";
    digestHour: number;
    digestDay: number;
    autoWatchCreator: boolean;
    autoWatchAssignee: boolean;
    autoWatchCommenter: boolean;
    autoWatchMentioned: boolean;
    presenceEnabled: boolean;
  } | null>(null);
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [defaultTimezone, setDefaultTimezone] = useState("UTC");
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifMsg, setNotifMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReduceMotionPref(getReduceMotionPreference());
      apiFetchJson("/api/account/notifications")
        .then((d: {
          preferences?: typeof notifPrefs;
          smtpConfigured?: boolean;
          defaultTimezone?: string;
        }) => {
          if (d.preferences) setNotifPrefs(d.preferences);
          setSmtpConfigured(Boolean(d.smtpConfigured));
          if (d.defaultTimezone) setDefaultTimezone(d.defaultTimezone);
        })
        .catch(() => undefined);
    }
  }, [open]);

  const updateNotifPref = async (patch: Record<string, unknown>) => {
    if (!notifPrefs) return;
    const optimistic = { ...notifPrefs, ...patch };
    setNotifPrefs(optimistic);
    setNotifSaving(true);
    setNotifMsg(null);
    try {
      const match =
        typeof document !== "undefined"
          ? document.cookie.match(/(?:^|;\s*)patchwork_csrf=([^;]+)/)
          : null;
      const csrfToken = match ? decodeURIComponent(match[1]) : undefined;
      const res = (await apiFetchJson(
        "/api/account/notifications",
        { method: "PUT", body: JSON.stringify(patch) },
        { csrfToken }
      )) as { preferences?: typeof notifPrefs };
      if (res.preferences) setNotifPrefs(res.preferences);
      setNotifMsg("Saved");
    } catch {
      setNotifMsg("Failed to save");
    } finally {
      setNotifSaving(false);
    }
  };

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
            {activeTab === "notifications" ? (
              <Bell className="h-4 w-4 text-[var(--pw-accent)]" />
            ) : (
              <Keyboard className="h-4 w-4 text-[var(--pw-accent)]" />
            )}
            <h2 className="text-sm font-semibold text-[var(--pw-ink)]">
              Account Settings
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

        <div role="tablist" aria-label="Account settings sections" className="mb-4 flex gap-1 border-b border-[var(--pw-border)] pb-2">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "general"}
            onClick={() => setActiveTab("general")}
            className={`rounded px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "general"
                ? "bg-[var(--pw-accent)] text-white"
                : "text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-hover)]"
            }`}
          >
            Preferences & Shortcuts
          </button>
          <button
            type="button"
            role="tab"
            data-testid="account-notifications-tab"
            aria-selected={activeTab === "notifications"}
            onClick={() => setActiveTab("notifications")}
            className={`rounded px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "notifications"
                ? "bg-[var(--pw-accent)] text-white"
                : "text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-hover)]"
            }`}
          >
            Notifications
          </button>
        </div>

        {activeTab === "notifications" ? (
          <Surface variant="dialog" className="max-h-[65vh] space-y-4 overflow-y-auto pr-1 text-xs" data-testid="account-notifications-panel">
            <SkeletonRegion
              isLoading={!notifPrefs}
              hasData={Boolean(notifPrefs)}
              loadingLabel="Loading notification preferences"
              readyLabel="Notification preferences loaded"
              skeleton={
                <div className="space-y-4" aria-hidden="true">
                  <Skeleton className="h-3 w-36" />
                  <Surface variant="card" className="divide-y divide-[var(--pw-border)] rounded-lg border border-[var(--pw-border)] bg-[var(--pw-bg)]">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="flex items-center justify-between gap-2 px-3 py-2.5">
                        <Skeleton className="h-3.5 w-28" />
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-5 w-16" />
                          <Skeleton className="h-6 w-24" />
                        </div>
                      </div>
                    ))}
                  </Surface>
                  <Skeleton className="h-3 w-32" />
                  <Surface variant="card" className="rounded-lg border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3 space-y-2.5">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="flex items-center justify-between">
                        <Skeleton className="h-3 w-44" />
                        <Skeleton className="h-4 w-4 rounded" />
                      </div>
                    ))}
                  </Surface>
                </div>
              }
            >
              {notifPrefs && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--pw-ink-muted)]">
                      Notification Channels
                    </span>
                    {notifMsg && (
                      <span className="text-[11px] text-[var(--pw-ink-muted)]">
                        {notifSaving ? "Saving..." : notifMsg}
                      </span>
                    )}
                  </div>

                  <div className="divide-y divide-[var(--pw-border)] rounded-lg border border-[var(--pw-border)] bg-[var(--pw-bg)]">
                    {(
                      [
                        {
                          label: "@Mentions",
                          inAppKey: "inAppMentions" as const,
                          emailKey: "emailMentions" as const,
                          allowImmediate: true,
                        },
                        {
                          label: "Assignments",
                          inAppKey: "inAppAssignments" as const,
                          emailKey: "emailAssignments" as const,
                          allowImmediate: true,
                        },
                        {
                          label: "Watched updates",
                          inAppKey: "inAppWatched" as const,
                          emailKey: "emailWatched" as const,
                          allowImmediate: false,
                        },
                      ]
                    ).map((row) => (
                      <div key={row.label} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                        <span className="font-medium text-[var(--pw-ink)]">{row.label}</span>
                        <div className="flex items-center gap-3">
                          <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--pw-ink-secondary)]">
                            <input
                              type="checkbox"
                              checked={notifPrefs[row.inAppKey]}
                              onChange={(e) =>
                                updateNotifPref({ [row.inAppKey]: e.target.checked })
                              }
                            />
                            <span>In-app</span>
                          </label>
                          {smtpConfigured && (
                            <select
                              aria-label={`${row.label} email preference`}
                              value={notifPrefs[row.emailKey]}
                              onChange={(e) =>
                                updateNotifPref({ [row.emailKey]: e.target.value })
                              }
                              className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2 py-1 text-[11px]"
                            >
                              <option value="off">Email: Off</option>
                              {row.allowImmediate && (
                                <option value="immediate">Email: Immediate</option>
                              )}
                              <option value="digest">Email: Digest</option>
                            </select>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {!smtpConfigured ? (
                    <p
                      data-testid="email-disabled-note"
                      className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2 text-[11px] text-[var(--pw-ink-muted)]"
                    >
                      Email notifications are disabled because SMTP is not configured by your administrator.
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-2.5">
                      <span className="text-[11px] font-medium text-[var(--pw-ink)]">Digest schedule ({defaultTimezone}):</span>
                      <select
                        aria-label="Digest frequency"
                        value={notifPrefs.digestFrequency}
                        onChange={(e) => updateNotifPref({ digestFrequency: e.target.value })}
                        className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2 py-1 text-[11px]"
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                      </select>
                      {notifPrefs.digestFrequency === "weekly" && (
                        <select
                          aria-label="Digest day of week"
                          value={notifPrefs.digestDay}
                          onChange={(e) => updateNotifPref({ digestDay: Number(e.target.value) })}
                          className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2 py-1 text-[11px]"
                        >
                          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, idx) => (
                            <option key={d} value={idx}>{d}</option>
                          ))}
                        </select>
                      )}
                      <select
                        aria-label="Digest hour"
                        value={notifPrefs.digestHour}
                        onChange={(e) => updateNotifPref({ digestHour: Number(e.target.value) })}
                        className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2 py-1 text-[11px]"
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--pw-ink-muted)]">
                    Auto-watch rules
                  </span>
                  <div className="divide-y divide-[var(--pw-border)] rounded-lg border border-[var(--pw-border)] bg-[var(--pw-bg)]">
                    {(
                      [
                        ["autoWatchCreator", "When I create a ticket"],
                        ["autoWatchAssignee", "When I am assigned to a ticket"],
                        ["autoWatchCommenter", "When I comment on a ticket"],
                        ["autoWatchMentioned", "When I am @mentioned"],
                        ["presenceEnabled", "Show when I'm viewing or typing on a ticket"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="flex items-center justify-between px-3 py-2 cursor-pointer">
                        <span className="text-[var(--pw-ink)]">{label}</span>
                        <input
                          type="checkbox"
                          checked={notifPrefs[key]}
                          onChange={(e) => updateNotifPref({ [key]: e.target.checked })}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </>
              )}
            </SkeletonRegion>
          </Surface>
        ) : (
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
        )}
            </div>
          </Scale>
        </div>
      )}
    </Presence>
  );
}

