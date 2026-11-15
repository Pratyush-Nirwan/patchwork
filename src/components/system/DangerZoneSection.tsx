"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { HoldToConfirmButton } from "./HoldToConfirmButton";

export function DangerZoneSection({
  orgId,
  csrfToken,
  showToast,
}: {
  orgId: string;
  csrfToken: string;
  showToast: (m: string, t?: "success" | "error") => void;
}) {
  const [archiveDays, setArchiveDays] = useState(90);
  const [archivePreview, setArchivePreview] = useState<number | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState("");
  const [archivePending, setArchivePending] = useState(false);

  const [deactivatedPreview, setDeactivatedPreview] = useState<
    Array<{ id: string; name: string; email: string }> | null
  >(null);
  const [deleteDeactivatedConfirm, setDeleteDeactivatedConfirm] = useState("");
  const [deletePending, setDeletePending] = useState(false);

  const handlePreviewArchive = async () => {
    try {
      const res = await fetch(`/api/system/danger/archive-tickets?days=${archiveDays}`, {
        headers: { "x-org-id": orgId },
      });
      const data = await res.json();
      setArchivePreview(data.affectedCount);
    } catch {
      showToast("Failed to preview archive", "error");
    }
  };

  const handleArchiveTickets = async () => {
    if (archiveConfirm !== "ARCHIVE TICKETS") return;
    setArchivePending(true);
    try {
      const res = await fetch("/api/system/danger/archive-tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
          "x-org-id": orgId,
        },
        body: JSON.stringify({ days: archiveDays, confirmText: archiveConfirm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      showToast(`Archived and purged ${data.affectedCount} tickets`);
      setArchiveConfirm("");
      setArchivePreview(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Archive failed", "error");
    } finally {
      setArchivePending(false);
    }
  };

  const handlePreviewDeactivated = async () => {
    try {
      const res = await fetch("/api/system/danger/delete-deactivated", {
        headers: { "x-org-id": orgId },
      });
      const data = await res.json();
      setDeactivatedPreview(data.users || []);
    } catch {
      showToast("Failed to preview deactivated users", "error");
    }
  };

  const handleDeleteDeactivated = async () => {
    if (deleteDeactivatedConfirm !== "DELETE DEACTIVATED") return;
    setDeletePending(true);
    try {
      const res = await fetch("/api/system/danger/delete-deactivated", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
          "x-org-id": orgId,
        },
        body: JSON.stringify({ confirmText: deleteDeactivatedConfirm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      showToast(`Permanently deleted ${data.deletedCount} deactivated users`);
      setDeleteDeactivatedConfirm("");
      setDeactivatedPreview(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Deletion failed", "error");
    } finally {
      setDeletePending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-red-500/20 pb-4">
        <h2 className="text-base font-semibold text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          <span>Danger Zone</span>
        </h2>
        <p className="text-xs text-[var(--pw-ink-secondary)]">
          Irreversible maintenance operations. Workspace setup wizard reset is explicitly prohibited.
        </p>
      </div>

      <div className="space-y-6 max-w-xl text-xs">
        {/* Operation 1: Archive old tickets */}
        <div className="rounded border border-red-500/30 bg-red-500/5 p-4 space-y-3">
          <div className="font-semibold text-sm text-[var(--pw-ink)]">
            Archive all tickets older than N days
          </div>
          <p className="text-[11px] text-[var(--pw-ink-secondary)]">
            Permanently purges tickets created more than N days ago.
          </p>

          <div className="flex items-center gap-3">
            <label className="text-[var(--pw-ink-secondary)]">Cutoff threshold (days):</label>
            <input
              type="number"
              min={7}
              data-testid="archive-tickets-days-input"
              value={archiveDays}
              onChange={(e) => setArchiveDays(parseInt(e.target.value, 10))}
              className="w-20 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-1 text-xs"
            />
            <button
              type="button"
              data-testid="preview-archive-tickets-btn"
              onClick={handlePreviewArchive}
              className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--pw-surface-muted)]"
            >
              Preview Count
            </button>
          </div>

          {archivePreview !== null && (
            <div className="space-y-2 pt-2 border-t border-red-500/20">
              <div className="text-amber-600 dark:text-amber-400 font-semibold">
                Affected tickets: {archivePreview}
              </div>
              <div>
                <label className="block text-[11px] text-[var(--pw-ink-secondary)] mb-1">
                  Type <code className="font-mono text-red-600">ARCHIVE TICKETS</code> to confirm:
                </label>
                <input
                  type="text"
                  data-testid="confirm-archive-tickets-input"
                  value={archiveConfirm}
                  onChange={(e) => setArchiveConfirm(e.target.value)}
                  placeholder="ARCHIVE TICKETS"
                  className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-1.5 text-xs font-mono"
                />
              </div>
              <HoldToConfirmButton
                disabled={archivePending || archiveConfirm !== "ARCHIVE TICKETS"}
                pending={archivePending}
                data-testid="execute-archive-tickets-btn"
                variant="danger"
                onConfirm={handleArchiveTickets}
                className="rounded px-3 py-1.5 text-xs font-semibold text-white"
                holdLabel="Holding to archive..."
              >
                Hold to Execute Archive
              </HoldToConfirmButton>
            </div>
          )}
        </div>

        {/* Operation 2: Delete all deactivated users */}
        <div className="rounded border border-red-500/30 bg-red-500/5 p-4 space-y-3">
          <div className="font-semibold text-sm text-[var(--pw-ink)]">
            Delete all deactivated users
          </div>
          <p className="text-[11px] text-[var(--pw-ink-secondary)]">
            Permanently deletes all deactivated user accounts. Preserves ticket comments by attributing to &quot;Deleted User&quot;.
          </p>

          <button
            type="button"
            data-testid="preview-delete-deactivated-btn"
            onClick={handlePreviewDeactivated}
            className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--pw-surface-muted)]"
          >
            Preview Deactivated Users
          </button>

          {deactivatedPreview !== null && (
            <div className="space-y-2 pt-2 border-t border-red-500/20">
              <div className="text-amber-600 dark:text-amber-400 font-semibold">
                Deactivated users count: {deactivatedPreview.length}
              </div>
              {deactivatedPreview.length > 0 && (
                <div className="max-h-24 overflow-y-auto font-mono text-[11px] rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-2">
                  {deactivatedPreview.map((u) => (
                    <div key={u.id}>
                      {u.name} ({u.email})
                    </div>
                  ))}
                </div>
              )}
              <div>
                <label className="block text-[11px] text-[var(--pw-ink-secondary)] mb-1">
                  Type <code className="font-mono text-red-600">DELETE DEACTIVATED</code> to confirm:
                </label>
                <input
                  type="text"
                  data-testid="confirm-delete-deactivated-input"
                  value={deleteDeactivatedConfirm}
                  onChange={(e) => setDeleteDeactivatedConfirm(e.target.value)}
                  placeholder="DELETE DEACTIVATED"
                  className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-1.5 text-xs font-mono"
                />
              </div>
              <HoldToConfirmButton
                disabled={deletePending || deleteDeactivatedConfirm !== "DELETE DEACTIVATED"}
                pending={deletePending}
                data-testid="execute-delete-deactivated-btn"
                variant="danger"
                onConfirm={handleDeleteDeactivated}
                className="rounded px-3 py-1.5 text-xs font-semibold text-white"
                holdLabel="Holding to delete..."
              >
                Hold to Permanently Delete Deactivated
              </HoldToConfirmButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
