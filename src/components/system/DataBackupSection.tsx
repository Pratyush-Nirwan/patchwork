"use client";

import { useState, useEffect } from "react";
import { Download, Copy } from "lucide-react";
import { Skeleton, SkeletonRegion, Surface } from "@/components/ui/skeleton";
import type { BackupCommands } from "./types";

export function DataBackupSection({
  showToast,
}: {
  showToast: (m: string) => void;
}) {
  const [commands, setCommands] = useState<BackupCommands | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/system/data/commands")
      .then((r) => r.json())
      .then((d) => setCommands(d.commands))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="border-b border-[var(--pw-border)] pb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--pw-ink)]">
            Data Export & Backup Operations
          </h2>
          <p className="text-xs text-[var(--pw-ink-secondary)]">
            Download organization archives and view native backup command instructions.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
        {/* Export Card */}
        <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 space-y-3">
          <h3 className="font-semibold text-xs text-[var(--pw-ink)]">
            Export Organization Data
          </h3>
          <p className="text-[11px] text-[var(--pw-ink-secondary)]">
            Export tickets, comments, projects, teams, and user metadata (passwords strictly excluded).
          </p>
          <div className="flex items-center gap-2 pt-2">
            <a
              href="/api/system/data/export?format=json"
              data-testid="export-json-btn"
              className="flex items-center gap-1.5 rounded bg-[var(--pw-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)]"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export as JSON</span>
            </a>
            <a
              href="/api/system/data/export?format=csv"
              data-testid="export-csv-btn"
              className="flex items-center gap-1.5 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--pw-surface-muted)]"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export Tickets CSV</span>
            </a>
          </div>
        </div>

        {/* Manual Backup Instructions */}
        <SkeletonRegion
          isLoading={loading}
          hasData={Boolean(commands)}
          loadingLabel="Loading backup commands"
          readyLabel="Backup commands loaded"
          skeleton={
            <Surface variant="surface" className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 space-y-3" aria-hidden="true">
              <Skeleton className="h-3.5 w-44" />
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-48" />
                <Surface variant="code" className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2">
                  <Skeleton className="h-4 w-full" />
                </Surface>
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-40" />
                <Surface variant="code" className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2">
                  <Skeleton className="h-4 w-3/4" />
                </Surface>
              </div>
            </Surface>
          }
        >
          {commands && (
          <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 space-y-3">
            <h3 className="font-semibold text-xs text-[var(--pw-ink)]">
              Manual System Backup Guide
            </h3>
            <div>
              <div className="text-[11px] text-[var(--pw-ink-secondary)] mb-1">
                PostgreSQL Dump Command (Native):
              </div>
              <div className="flex items-center gap-2 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2">
                <code className="flex-1 font-mono text-[10px] text-[var(--pw-ink)] break-all">
                  {commands.pgDumpCommand}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(commands.pgDumpCommand);
                    showToast("pg_dump command copied");
                  }}
                  className="rounded p-1 text-[var(--pw-ink-secondary)] hover:text-[var(--pw-ink)]"
                  title="Copy command"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div>
              <div className="text-[11px] text-[var(--pw-ink-secondary)] mb-1">
                MinIO Storage Data Directory:
              </div>
              <div className="flex items-center gap-2 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2">
                <code className="flex-1 font-mono text-[10px] text-[var(--pw-ink)] break-all">
                  {commands.minioDataPath}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(commands.minioDataPath);
                    showToast("MinIO data path copied");
                  }}
                  className="rounded p-1 text-[var(--pw-ink-secondary)] hover:text-[var(--pw-ink)]"
                  title="Copy path"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
          )}
        </SkeletonRegion>
      </div>
    </div>
  );
}

// ==========================================
// SECTION L: DANGER ZONE
// ==========================================
