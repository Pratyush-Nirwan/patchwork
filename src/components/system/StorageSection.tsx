"use client";

import React,{ useState,useEffect,useCallback } from "react";
import { SystemSectionSkeleton } from "@/components/skeletons/SystemConfigSkeleton";
import { HoldToConfirmButton } from "./HoldToConfirmButton";
import type { StorageHealthData,StorageOrphanItem } from "./types";

export function StorageSection({
  csrfToken,
  showToast,
}: {
  csrfToken: string;
  showToast: (m: string, t?: "success" | "error") => void;
}) {
  const [maxBytes, setMaxBytes] = useState(5 * 1024 * 1024);
  const [allowedExtensions, setAllowedExtensions] = useState<string[]>([]);
  const [healthData, setHealthData] = useState<StorageHealthData | null>(null);
  const [orphans, setOrphans] = useState<StorageOrphanItem[] | null>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [settingsRes, healthRes] = await Promise.all([
        fetch("/api/system/settings/storage"),
        fetch("/api/system/storage/health"),
      ]);
      const s = await settingsRes.json();
      const h = await healthRes.json();
      if (s.settings) {
        setMaxBytes(s.settings.maxAttachmentBytes);
        setAllowedExtensions(s.settings.allowedExtensions);
      }
      setHealthData(h);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    try {
      const res = await fetch("/api/system/settings/storage", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          maxAttachmentBytes: maxBytes,
          allowedExtensions,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      showToast("Storage settings updated successfully");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setPending(false);
    }
  };

  const handleScanOrphans = async () => {
    try {
      const res = await fetch("/api/system/storage/orphans");
      const d = await res.json();
      setOrphans(d.orphans || []);
      showToast(`Scan complete: found ${d.orphans?.length || 0} orphaned objects`);
    } catch {
      showToast("Failed to scan orphans", "error");
    }
  };

  const handleDeleteOrphans = async () => {
    if (!orphans || orphans.length === 0) return;
    if (!confirm(`Permanently delete ${orphans.length} orphaned objects from MinIO?`)) return;
    try {
      const res = await fetch("/api/system/storage/orphans", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ keys: orphans.map((o) => o.key) }),
      });
      const data = await res.json();
      showToast(`Deleted ${data.deletedCount} orphaned objects`);
      setOrphans(null);
      loadData();
    } catch {
      showToast("Failed to delete orphans", "error");
    }
  };

  const handleReset = async () => {
    try {
      await fetch("/api/system/settings/storage", {
        method: "DELETE",
        headers: { "x-csrf-token": csrfToken },
      });
      showToast("Storage settings reset to defaults");
      loadData();
    } catch {
      showToast("Reset failed", "error");
    }
  };

  if (loading) return <SystemSectionSkeleton variant="section" />;

  return (
    <div className="space-y-6">
      <div className="border-b border-[var(--pw-border)] pb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--pw-ink)]">
            Attachments & Object Storage
          </h2>
          <p className="text-xs text-[var(--pw-ink-secondary)]">
            MinIO connection status, file upload constraints, and storage maintenance.
          </p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="text-xs text-[var(--pw-ink-secondary)] hover:text-[var(--pw-ink)] underline"
        >
          Reset to default
        </button>
      </div>

      {/* Health & Metrics Card */}
      {healthData && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-3.5">
            <div className="text-[11px] text-[var(--pw-ink-secondary)]">MinIO Status</div>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  healthData.minio.status === "healthy" ? "bg-emerald-500" : "bg-rose-500"
                }`}
              />
              <span className="font-semibold text-xs capitalize text-[var(--pw-ink)]">
                {healthData.minio.status}
              </span>
              <span className="text-[11px] font-mono text-[var(--pw-ink-tertiary)]">
                ({healthData.minio.latencyMs}ms)
              </span>
            </div>
            <div className="mt-1 text-[11px] text-[var(--pw-ink-tertiary)] font-mono">
              Bucket: {healthData.minio.bucket}
            </div>
          </div>

          <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-3.5">
            <div className="text-[11px] text-[var(--pw-ink-secondary)]">Storage Used</div>
            <div className="mt-1 font-mono font-bold text-sm text-[var(--pw-ink)]">
              {(healthData.storageUsedBytes / (1024 * 1024)).toFixed(2)} MB
            </div>
            <div className="mt-1 text-[11px] text-[var(--pw-ink-tertiary)]">
              Across all ticket attachments
            </div>
          </div>

          <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-3.5">
            <div className="text-[11px] text-[var(--pw-ink-secondary)]">Total Attachments</div>
            <div className="mt-1 font-mono font-bold text-sm text-[var(--pw-ink)]">
              {healthData.totalAttachmentsCount}
            </div>
            <div className="mt-1 text-[11px] text-[var(--pw-ink-tertiary)]">
              Database rows tracked
            </div>
          </div>
        </div>
      )}

      {/* Settings Form */}
      <form onSubmit={handleSave} className="max-w-xl space-y-4 text-xs">
        <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 space-y-3">
          <h3 className="font-semibold text-xs text-[var(--pw-ink)]">
            Upload Constraints
          </h3>

          <div>
            <label className="block text-[var(--pw-ink-secondary)] mb-1">
              Maximum File Size (MB)
            </label>
            <input
              type="number"
              min={1}
              max={100}
              data-testid="storage-max-file-size"
              value={Math.round(maxBytes / (1024 * 1024))}
              onChange={(e) => setMaxBytes(parseInt(e.target.value, 10) * 1024 * 1024)}
              className="w-24 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-1.5 text-xs"
            />
          </div>

          <div>
            <label className="block text-[var(--pw-ink-secondary)] mb-1">
              Allowed File Extensions (comma-separated)
            </label>
            <input
              type="text"
              data-testid="storage-allowed-extensions"
              value={allowedExtensions.join(", ")}
              onChange={(e) =>
                setAllowedExtensions(
                  e.target.value
                    .split(",")
                    .map((s) => s.trim().toLowerCase())
                    .filter(Boolean)
                )
              }
              className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-1.5 text-xs font-mono"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={pending}
          data-testid="save-storage-btn"
          className="rounded bg-[var(--pw-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save Storage Settings"}
        </button>
      </form>

      {/* Orphan Cleanup Card */}
      <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-xs text-[var(--pw-ink)]">
              Orphaned Object Cleanup
            </h3>
            <p className="text-[11px] text-[var(--pw-ink-secondary)]">
              Detects objects stored in MinIO that have no matching database row and allows safe removal.
            </p>
          </div>
          <button
            type="button"
            data-testid="scan-orphans-btn"
            onClick={handleScanOrphans}
            className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--pw-surface-muted)]"
          >
            Scan MinIO
          </button>
        </div>

        {orphans && (
          <div className="space-y-2 pt-2 border-t border-[var(--pw-border)]">
            <div className="text-xs">
              {orphans.length === 0 ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                  Zero orphaned objects detected. Bucket is cleanly synchronized.
                </span>
              ) : (
                <div className="space-y-2">
                  <div className="text-amber-600 dark:text-amber-400 font-medium">
                    Found {orphans.length} orphaned objects:
                  </div>
                  <div className="max-h-32 overflow-y-auto font-mono text-[11px] rounded border border-[var(--pw-border)] p-2">
                    {orphans.map((o) => (
                      <div key={o.key} className="truncate">
                        {o.key} ({(o.sizeBytes / 1024).toFixed(1)} KB)
                      </div>
                    ))}
                  </div>
                  <HoldToConfirmButton
                    data-testid="delete-orphans-btn"
                    variant="danger"
                    onConfirm={handleDeleteOrphans}
                    className="rounded px-3 py-1.5 text-xs font-semibold text-white"
                    holdLabel="Holding to delete..."
                  >
                    Hold to Delete {orphans.length} Orphaned Objects
                  </HoldToConfirmButton>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// SECTION G: SEARCH
// ==========================================
