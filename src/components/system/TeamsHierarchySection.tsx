"use client";

import { useState,useEffect,useCallback } from "react";
import { SystemSectionSkeleton } from "@/components/skeletons/SystemConfigSkeleton";
import type { TeamHierarchyItem } from "./types";

export function TeamsHierarchySection({
  orgId,
  csrfToken,
  showToast,
}: {
  orgId: string;
  csrfToken: string;
  showToast: (m: string, t?: "success" | "error") => void;
}) {
  const [teamsData, setTeamsData] = useState<TeamHierarchyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);

  const loadHierarchy = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/system/teams-projects-boards", {
        headers: { "x-org-id": orgId },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTeamsData(data.teams || []);
      if (!activeTeamId && data.teams?.length > 0) {
        setActiveTeamId(data.teams[0].id);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load teams", "error");
    } finally {
      setLoading(false);
    }
  }, [orgId, activeTeamId, showToast]);

  useEffect(() => {
    loadHierarchy();
  }, [loadHierarchy]);

  const activeTeam = teamsData.find((t) => t.id === activeTeamId) || teamsData[0];

  return (
    <div className="space-y-4">
      <div className="border-b border-[var(--pw-border)] pb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--pw-ink)]">
            Teams, Projects & Boards
          </h2>
          <p className="text-xs text-[var(--pw-ink-secondary)]">
            Manage engineering hierarchy, project team ownership, and board column configurations.
          </p>
        </div>
      </div>

      {loading ? (
        <SystemSectionSkeleton variant="hierarchy" />
      ) : teamsData.length === 0 ? (
        <div className="text-xs text-[var(--pw-ink-secondary)]">No teams configured yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Teams list */}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--pw-ink-secondary)]">
              Teams ({teamsData.length})
            </div>
            {teamsData.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTeamId(t.id)}
                className={`w-full text-left rounded border p-3 text-xs transition ${
                  activeTeam?.id === t.id
                    ? "border-[var(--pw-accent)] bg-[var(--pw-surface)] shadow-xs"
                    : "border-[var(--pw-border)] bg-[var(--pw-surface)] hover:border-[var(--pw-accent)]"
                }`}
              >
                <div className="font-semibold text-[var(--pw-ink)]">{t.name}</div>
                <div className="text-[11px] text-[var(--pw-ink-secondary)] font-mono">/{t.slug}</div>
                <div className="mt-2 flex items-center gap-3 text-[10px] text-[var(--pw-ink-tertiary)]">
                  <span>{t.dependencies?.projectsCount || 0} projects</span>
                  <span>{t.dependencies?.boardsCount || 0} boards</span>
                  <span>{t.dependencies?.ticketsCount || 0} tickets</span>
                </div>
              </button>
            ))}
          </div>

          {/* Active Team Detail & Projects */}
          {activeTeam && (
            <div className="md:col-span-2 space-y-4">
              <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm text-[var(--pw-ink)]">
                    Team: {activeTeam.name}
                  </h3>
                  <span className="text-[11px] text-[var(--pw-ink-secondary)]">
                    Lead: {activeTeam.leads?.map((l: { id: string; name: string }) => l.name).join(", ") || "Unassigned"}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-[var(--pw-ink-secondary)]">
                    Projects under {activeTeam.name}:
                  </div>
                  {activeTeam.projects?.length === 0 ? (
                    <div className="text-xs text-[var(--pw-ink-tertiary)] italic">
                      No projects in this team.
                    </div>
                  ) : (
                    activeTeam.projects?.map((p) => (
                      <div
                        key={p.id}
                        className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3 text-xs flex items-center justify-between"
                      >
                        <div>
                          <div className="font-medium text-[var(--pw-ink)] flex items-center gap-1.5">
                            <span className="font-mono bg-[var(--pw-surface)] px-1 rounded border border-[var(--pw-border)]">
                              {p.key}
                            </span>
                            <span>{p.name}</span>
                          </div>
                          <div className="text-[11px] text-[var(--pw-ink-tertiary)] mt-1">
                            {p.boards?.length || 0} boards ({p.boards?.map((b: { id: string; name: string }) => b.name).join(", ")})
                          </div>
                        </div>

                        {/* Move project select */}
                        <div className="flex items-center gap-2">
                          <label className="text-[11px] text-[var(--pw-ink-secondary)]">
                            Move team:
                          </label>
                          <select
                            data-testid={`move-project-${p.id}`}
                            value={activeTeam.id}
                            onChange={async (e) => {
                              const newTeamId = e.target.value;
                              if (newTeamId === activeTeam.id) return;
                              try {
                                const res = await fetch("/api/system/teams-projects-boards", {
                                  method: "PATCH",
                                  headers: {
                                    "Content-Type": "application/json",
                                    "x-csrf-token": csrfToken,
                                    "x-org-id": orgId,
                                  },
                                  body: JSON.stringify({
                                    action: "move-project",
                                    projectId: p.id,
                                    newTeamId,
                                  }),
                                });
                                const data = await res.json();
                                if (!res.ok) throw new Error(data.message || data.error);
                                showToast(`Project ${p.name} moved to new team`);
                                loadHierarchy();
                              } catch (err) {
                                showToast(err instanceof Error ? err.message : "Move failed", "error");
                              }
                            }}
                            className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2 py-1 text-xs"
                          >
                            {teamsData.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==========================================
// SECTION D: ROLES & PERMISSIONS
// ==========================================
