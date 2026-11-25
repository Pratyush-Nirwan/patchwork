"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { Skeleton, SkeletonRegion, Surface } from "@/components/ui/skeleton";
import type { SearchStatusData } from "./types";

export function SearchSection({
  csrfToken,
  showToast,
}: {
  csrfToken: string;
  showToast: (m: string, t?: "success" | "error") => void;
}) {
  const [status, setStatus] = useState<SearchStatusData | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/system/search");
      const d = await res.json();
      setStatus(d.status);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      const res = await fetch("/api/system/search", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      showToast("Search indexes rebuilt successfully");
      loadStatus();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Rebuild failed", "error");
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="border-b border-[var(--pw-border)] pb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--pw-ink)]">
            Search Index Management
          </h2>
          <p className="text-xs text-[var(--pw-ink-secondary)]">
            PostgreSQL full-text search tsvector GIN indexes for tickets, comments, and attachments.
          </p>
        </div>
      </div>

      <SkeletonRegion
        isLoading={loading}
        hasData={!loading}
        loadingLabel="Loading search index status"
        readyLabel="Search index status loaded"
        skeleton={
          <div className="space-y-4" aria-hidden="true" data-testid="search-status-skeleton">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => (
                <Surface key={i} variant="surface" className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-3.5 space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-5 w-14" />
                  <Skeleton className="h-3 w-36" />
                </Surface>
              ))}
            </div>
            <Surface variant="surface" className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 flex items-center justify-between gap-4">
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-72" />
              </div>
              <Skeleton className="h-8 w-28" />
            </Surface>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-3.5">
              <div className="text-[11px] text-[var(--pw-ink-secondary)]">Indexed Tickets</div>
              <div className="mt-1 font-mono font-bold text-sm text-[var(--pw-ink)]">
                {status?.indexedTickets || 0}
              </div>
              <div className="mt-1 text-[11px] text-[var(--pw-ink-tertiary)]">
                GIN search vector active
              </div>
            </div>

            <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-3.5">
              <div className="text-[11px] text-[var(--pw-ink-secondary)]">Indexed Comments</div>
              <div className="mt-1 font-mono font-bold text-sm text-[var(--pw-ink)]">
                {status?.indexedComments || 0}
              </div>
              <div className="mt-1 text-[11px] text-[var(--pw-ink-tertiary)]">
                Discussion text vectors
              </div>
            </div>

            <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-3.5">
              <div className="text-[11px] text-[var(--pw-ink-secondary)]">Indexed Attachments</div>
              <div className="mt-1 font-mono font-bold text-sm text-[var(--pw-ink)]">
                {status?.indexedAttachments || 0}
              </div>
              <div className="mt-1 text-[11px] text-[var(--pw-ink-tertiary)]">
                Filename & text extractions
              </div>
            </div>
          </div>

          <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 flex items-center justify-between">
            <div>
              <div className="font-semibold text-xs text-[var(--pw-ink)]">
                Rebuild GIN Search Index
              </div>
              <div className="text-[11px] text-[var(--pw-ink-secondary)]">
                Regenerates search index trees using PostgreSQL REINDEX with a mutual exclusion lock.
              </div>
            </div>

            <button
              type="button"
              disabled={rebuilding || status?.isRebuilding}
              data-testid="rebuild-search-index-btn"
              onClick={handleRebuild}
              className="flex items-center gap-2 rounded bg-[var(--pw-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${rebuilding ? "animate-spin" : ""}`} />
              <span>{rebuilding ? "Rebuilding..." : "Rebuild Index"}</span>
            </button>
          </div>
        </div>
      </SkeletonRegion>
    </div>
  );
}

// ==========================================
// SECTION H: INTEGRATIONS
// ==========================================
