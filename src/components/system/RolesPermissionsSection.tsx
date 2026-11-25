"use client";

import { useState,useEffect } from "react";
import { Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function RolesPermissionsSection() {
  const [matrix, setMatrix] = useState<
    Array<{
      id: string;
      action: string;
      description: string;
      allowedRoles: string[];
    }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/system/roles-permissions")
      .then((r) => r.json())
      .then((d) => {
        setMatrix(d.permissions || []);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div className="border-b border-[var(--pw-border)] pb-4">
        <h2 className="text-base font-semibold text-[var(--pw-ink)]">
          Roles & Permissions Matrix
        </h2>
        <p className="text-xs text-[var(--pw-ink-secondary)]">
          Read-only authorization enforcement view. Live definitions synchronized directly with runtime RBAC rules.
        </p>
      </div>

      <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[var(--pw-border)] bg-[var(--pw-surface-muted)] text-[var(--pw-ink-secondary)]">
              <th className="py-2.5 px-3 font-semibold w-1/3">Action / Capability</th>
              <th className="py-2.5 px-3 font-semibold text-center w-24">Admin</th>
              <th className="py-2.5 px-3 font-semibold text-center w-24">Team Lead</th>
              <th className="py-2.5 px-3 font-semibold text-center w-24">Member</th>
              <th className="py-2.5 px-3 font-semibold text-center w-24">Viewer</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--pw-border)]">
            {loading ? (
              Array.from({ length: 5 }).map((_, rIdx) => (
                <tr key={rIdx} data-sk-surface="table-row" aria-hidden="true">
                  <td className="px-3 py-2.5 space-y-1">
                    <Skeleton className="h-3.5 w-36" />
                    <Skeleton className="h-2.5 w-52" />
                  </td>
                  {[0, 1, 2, 3].map((cIdx) => (
                    <td key={cIdx} className="px-3 py-2.5 text-center">
                      <Skeleton className="mx-auto h-5 w-5" />
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              matrix.map((p) => (
                <tr key={p.id} className="hover:bg-[var(--pw-surface-muted)]">
                  <td className="py-2 px-3">
                    <div className="font-medium text-[var(--pw-ink)]">{p.action}</div>
                    <div className="text-[11px] text-[var(--pw-ink-tertiary)]">{p.description}</div>
                  </td>
                  {["admin", "lead", "member", "viewer"].map((role) => {
                    const allowed = p.allowedRoles.includes(role);
                    return (
                      <td key={role} className="py-2 px-3 text-center">
                        {allowed ? (
                          <span className="inline-flex items-center justify-center h-5 w-5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            <Check className="h-3.5 w-3.5" />
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center h-5 w-5 text-[var(--pw-ink-tertiary)]">
                            —
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==========================================
// SECTION E: SECURITY
// ==========================================
