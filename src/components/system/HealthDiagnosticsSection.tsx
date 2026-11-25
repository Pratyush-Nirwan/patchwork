"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Download } from "lucide-react";
import { Skeleton, SkeletonRegion, Surface } from "@/components/ui/skeleton";
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

      <SkeletonRegion
        isLoading={loading}
        hasData={Boolean(diagnostics)}
        loadingLabel="Loading system diagnostics"
        readyLabel="System diagnostics loaded"
        skeleton={
          <div className="space-y-6" aria-hidden="true" data-testid="health-diagnostics-skeleton">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <Surface key={i} variant="surface" className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-3 space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-4 w-28" />
                </Surface>
              ))}
            </div>
            <Surface variant="surface" className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[0, 1, 2].map((i) => (
                  <Surface key={i} variant="card" className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2.5 space-y-1.5">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3.5 w-32" />
                  </Surface>
                ))}
              </div>
            </Surface>
          </div>
        }
      >
        {diagnostics && (
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

          {diagnostics.worker && (
            <div
              data-testid="worker-health-card"
              className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-xs text-[var(--pw-ink)]">
                    Background Worker ({diagnostics.worker.mode})
                  </h3>
                  <p className="text-[11px] text-[var(--pw-ink-secondary)]">
                    Processed {diagnostics.worker.processedEvents} events
                    {diagnostics.worker.lastHeartbeatAt
                      ? ` · Last heartbeat ${new Date(diagnostics.worker.lastHeartbeatAt).toLocaleTimeString()}`
                      : ""}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    diagnostics.worker.status === "healthy"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : diagnostics.worker.status === "stale"
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      : "bg-slate-500/10 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {diagnostics.worker.status}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(
                  [
                    ["Domain Events", diagnostics.worker.queues.domainEvents],
                    ["Email Outbox", diagnostics.worker.queues.emailOutbox],
                    ["Webhook Deliveries", diagnostics.worker.queues.webhookDeliveries],
                  ] as const
                ).map(([label, q]) => (
                  <div
                    key={label}
                    className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2.5"
                  >
                    <div className="text-[11px] font-medium text-[var(--pw-ink-secondary)]">
                      {label}
                    </div>
                    <div className="mt-1 flex items-baseline gap-3 font-mono text-xs text-[var(--pw-ink)]">
                      <span>Pending: {q.pending}</span>
                      <span className={q.deadLettered > 0 ? "text-amber-600 dark:text-amber-400" : "text-[var(--pw-ink-muted)]"}>
                        Dead: {q.deadLettered}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-[var(--pw-ink-muted)]">
                      Oldest pending: {q.oldestPendingAgeSec != null ? `${q.oldestPendingAgeSec}s` : "—"}
                    </div>
                  </div>
                ))}
              </div>

              {diagnostics.worker.lastError && (
                <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300 font-mono">
                  Last worker error: {diagnostics.worker.lastError}
                </div>
              )}
            </div>
          )}

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
        )}
      </SkeletonRegion>
    </div>
  );
}

// ==========================================
// SECTION K: DATA & BACKUP
// ==========================================
