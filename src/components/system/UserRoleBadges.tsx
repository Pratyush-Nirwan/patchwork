"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Users, Building2, FolderKanban, Shield, Lock, HardDrive, Search, Share2,
  Palette, Activity, Database, AlertTriangle, ArrowLeft, Sun, Moon, RefreshCw,
  Plus, Trash2, Edit2, Key, LogOut, Upload, Download, Copy, Check,
  CheckCircle2, XCircle, Menu, X,
} from "lucide-react";

export function UserRoleBadges({
  role,
  teams = [],
}: {
  role: "admin" | "member";
  teams?: Array<{ id?: string; name: string; role: string; subRole?: string | null }>;
}) {
  if (role === "admin") {
    return (
      <span
        data-testid="badge-role-admin"
        className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20"
      >
        Admin
      </span>
    );
  }

  if (!teams || teams.length === 0) {
    return (
      <span
        data-testid="badge-no-team"
        className="text-[11px] text-[var(--pw-ink-tertiary)] italic"
      >
        No team
      </span>
    );
  }

  const getRoleStyle = (r: string, subRole?: string | null) => {
    switch (r.toLowerCase()) {
      case "lead":
        return "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/20";
      case "viewer":
        return "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20";
      case "member":
      default: {
        switch (subRole?.toLowerCase()) {
          case "tester":
            return "bg-teal-500/10 text-teal-800 dark:text-teal-300 border-teal-500/20";
          case "designer":
            return "bg-pink-500/10 text-pink-800 dark:text-pink-300 border-pink-500/20";
          case "devops":
            return "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/20";
          case "general":
            return "bg-indigo-500/10 text-indigo-800 dark:text-indigo-300 border-indigo-500/20";
          case "developer":
          default:
            return "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20";
        }
      }
    }
  };

  const capitalize = (s: string) => {
    if (s.toLowerCase() === "devops") return "DevOps";
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const getRoleLabel = (t: { role: string; subRole?: string | null }) => {
    if (t.role.toLowerCase() === "member" && t.subRole && t.subRole.toLowerCase() !== "member") {
      return capitalize(t.subRole);
    }
    return capitalize(t.role);
  };

  const visibleTeams = teams.slice(0, 2);
  const remainingCount = teams.length - 2;

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="user-role-badges">
      {visibleTeams.map((t, idx) => (
        <span
          key={t.id || idx}
          data-testid={`badge-team-${t.role.toLowerCase()}`}
          data-subrole={t.subRole || undefined}
          className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium border ${getRoleStyle(
            t.role,
            t.subRole
          )}`}
        >
          {t.name} · {getRoleLabel(t)}
        </span>
      ))}

      {remainingCount > 0 && (
        <div className="relative group inline-block">
          <button
            type="button"
            aria-label={`${remainingCount} more team memberships`}
            data-testid="badge-more-teams"
            className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-[var(--pw-surface-muted)] text-[var(--pw-ink-secondary)] border border-[var(--pw-border)] hover:bg-[var(--pw-border)] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--pw-accent)]"
          >
            +{remainingCount}
          </button>
          <div
            role="tooltip"
            data-testid="teams-popover"
            className="absolute left-0 bottom-full mb-1.5 hidden group-hover:flex group-focus-within:flex flex-col gap-1.5 z-30 min-w-[200px] p-2.5 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] shadow-lg text-[11px]"
          >
            <div className="font-semibold text-[var(--pw-ink)] pb-1 border-b border-[var(--pw-border)]">
              All Team Memberships ({teams.length})
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1 pt-0.5">
              {teams.map((t, idx) => (
                <div key={t.id || idx} className="flex items-center justify-between gap-2">
                  <span className="text-[var(--pw-ink)] truncate font-medium">{t.name}</span>
                  <span
                    className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border ${getRoleStyle(
                      t.role,
                      t.subRole
                    )}`}
                  >
                    {getRoleLabel(t)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
