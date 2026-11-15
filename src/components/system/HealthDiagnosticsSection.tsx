"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Users, Building2, FolderKanban, Shield, Lock, HardDrive, Search, Share2,
  Palette, Activity, Database, AlertTriangle, ArrowLeft, Sun, Moon, RefreshCw,
  Plus, Trash2, Edit2, Key, LogOut, Upload, Download, Copy, Check,
  CheckCircle2, XCircle, Menu, X,
} from "lucide-react";
import { SystemSectionSkeleton } from "@/components/skeletons/SystemConfigSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import type { ServerErrorLog, SystemDiagnostics } from "./types";

export function HealthDiagnosticsSection() {
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDiagnostics = useCallback(async () => {
    try {
      const res = await fetch("/api/system/health/diagnostics");
      const d = await res.json();
      setDiagnostics(d.diagnostics);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDiagnostics();
  }, [loadDiagnostics]);

  return (
    <div className="space-y-6">
      <div className="border-b border-[var(--pw-border)] pb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--pw-ink)]">
            System Health & Diagnostics
          </h2>
          <p className="text-xs text-[var(--pw-ink-secondary)]">
            Runtime metrics, connection latencies, and sanitized application error logs.
          </p>
        </div>

        <a
          href="/api/system/health/diagnostics?download=1"
          data-testid="download-diagnostics-btn"
          className="flex items-center gap-1.5 rounded bg-[var(--pw-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] transition"
        >
          <Download className="h-3.5 w-3.5" />
          <span>Download Diagnostics Bundle</span>
        </a>
      </div>

      {loading ? (
        <div className="text-xs text-[var(--pw-ink-secondary)]">Loading diagnostics...</div>
      ) : diagnostics ? (
        <div className="space-y-6 text-xs">
          {/* Telemetry Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-3">
              <div className="text-[11px] text-[var(--pw-ink-secondary)]">App & Node Version</div>
              <div className="mt-1 font-mono font-semibold text-[var(--pw-ink)]">
                v{diagnostics.appVersion} / {diagnostics.nodeVersion}
              </div>
            </div>

            <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-3">
              <div className="text-[11px] text-[var(--pw-ink-secondary)]">Database Latency</div>
              <div className="mt-1 font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                {diagnostics.database.latencyMs}ms ({diagnostics.database.status})
              </div>
            </div>

            <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-3">
              <div className="text-[11px] text-[var(--pw-ink-secondary)]">Active SSE Listeners</div>
              <div className="mt-1 font-mono font-semibold text-[var(--pw-ink)]">
                {diagnostics.sseConnectionCount} clients
              </div>
            </div>

            <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-3">
              <div className="text-[11px] text-[var(--pw-ink-secondary)]">Server Uptime</div>
              <div className="mt-1 font-mono font-semibold text-[var(--pw-ink)]">
                {Math.floor(diagnostics.serverUptimeSec / 3600)}h{" "}
                {Math.floor((diagnostics.serverUptimeSec % 3600) / 60)}m
              </div>
            </div>
          </div>

          {/* Error Log Ring Buffer */}
          <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-xs text-[var(--pw-ink)]">
                Recent Server Errors (Last {diagnostics.recentErrors?.length || 0})
              </h3>
              <span className="text-[11px] text-[var(--pw-ink-tertiary)]">
                All tokens, passwords, and secrets sanitized
              </span>
            </div>

            {diagnostics.recentErrors?.length === 0 ? (
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 italic">
                Zero server errors logged in memory buffer.
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto rounded border border-[var(--pw-border)] divide-y divide-[var(--pw-border)] font-mono text-[11px]">
                {diagnostics.recentErrors.map((err: ServerErrorLog, idx: number) => (
                  <div key={idx} className="p-2 space-y-1">
                    <div className="flex items-center justify-between text-red-500 font-semibold">
                      <span>{err.message}</span>
                      <span className="text-[10px] text-[var(--pw-ink-tertiary)]">{err.timestamp}</span>
                    </div>
                    {err.path && <div className="text-[var(--pw-ink-secondary)]">Path: {err.path}</div>}
                    {err.stack && (
                      <pre className="text-[10px] text-[var(--pw-ink-tertiary)] whitespace-pre-wrap max-h-20 overflow-y-auto">
                        {err.stack}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ==========================================
// SECTION K: DATA & BACKUP
// ==========================================
