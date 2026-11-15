"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Users, Building2, FolderKanban, Shield, Lock, HardDrive, Search, Share2,
  Palette, Activity, Database, AlertTriangle, ArrowLeft, Sun, Moon, RefreshCw,
  Plus, Trash2, Edit2, Key, LogOut, Upload, Download, Copy, Check,
  CheckCircle2, XCircle, Menu, X,
} from "lucide-react";
import { HoldToConfirmButton } from "./HoldToConfirmButton";
import type { TeamHierarchyItem, UserItem } from "./types";

export function AddUserModal({
  orgId,
  csrfToken,
  onClose,
  onSuccess,
}: {
  orgId: string;
  csrfToken: string;
  onClose: () => void;
  onSuccess: (res: { user: UserItem; generatedPassword: string }) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [passwordOption, setPasswordOption] = useState<"system" | "random">("system");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/system/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
          "x-org-id": orgId,
        },
        body: JSON.stringify({
          name,
          email,
          role,
          passwordOption,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      onSuccess(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add user");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        data-testid="add-user-modal"
        className="w-full max-w-md rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-6 shadow-xl"
      >
        <h3 className="text-sm font-semibold text-[var(--pw-ink)] mb-4">
          Add New User
        </h3>

        {error && (
          <div className="mb-4 rounded bg-red-500/10 border border-red-500/20 p-2 text-xs text-red-500">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium text-[var(--pw-ink-secondary)] mb-1">
              Full Name
            </label>
            <input
              type="text"
              required
              data-testid="add-user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Priya Sharma"
              className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2 text-[var(--pw-ink)]"
            />
          </div>

          <div>
            <label className="block font-medium text-[var(--pw-ink-secondary)] mb-1">
              Work Email
            </label>
            <input
              type="email"
              required
              data-testid="add-user-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="priya@example.com"
              className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2 text-[var(--pw-ink)]"
            />
          </div>

          <div>
            <label className="block font-medium text-[var(--pw-ink-secondary)] mb-1">
              Organization Role
            </label>
            <select
              data-testid="add-user-role"
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "member")}
              className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2 text-[var(--pw-ink)]"
            >
              <option value="member">Member</option>
              <option value="admin">Administrator</option>
            </select>
          </div>

          <div>
            <label className="block font-medium text-[var(--pw-ink-secondary)] mb-1">
              Initial Password Strategy
            </label>
            <div className="space-y-1.5 pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="passwordOption"
                  checked={passwordOption === "system"}
                  onChange={() => setPasswordOption("system")}
                />
                <span>
                  <strong>System password:</strong> Name-based pattern with random digits (e.g.{" "}
                  <code>PriyaS@4821</code>)
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="passwordOption"
                  checked={passwordOption === "random"}
                  onChange={() => setPasswordOption("random")}
                />
                <span>
                  <strong>Cryptographically random:</strong> 16-character secure random password
                </span>
              </label>
            </div>
            <p className="mt-2 text-[11px] text-[var(--pw-ink-tertiary)]">
              All new users are flagged with <code>must_change_password = true</code>.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--pw-border)]">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-xs text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              data-testid="add-user-submit"
              className="rounded bg-[var(--pw-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50"
            >
              {pending ? "Adding..." : "Add User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function EditUserModal({
  user,
  availableTeams,
  csrfToken,
  orgId,
  onClose,
  onSuccess,
}: {
  user: UserItem;
  availableTeams: Array<{ id: string; name: string }>;
  csrfToken: string;
  orgId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState(user.role);
  const [isDeactivated, setIsDeactivated] = useState(user.status === "deactivated");
  const [userTeams, setUserTeams] = useState<
    Map<string, { role: "lead" | "member" | "viewer"; subRole?: string | null }>
  >(() => {
    const map = new Map<string, { role: "lead" | "member" | "viewer"; subRole?: string | null }>();
    for (const t of user.teams) {
      map.set(t.id, {
        role: (t.role.toLowerCase() as "lead" | "member" | "viewer") || "member",
        subRole: t.subRole || "developer",
      });
    }
    return map;
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const teamsPayload = Array.from(userTeams.entries()).map(
        ([teamId, { role: r, subRole: sr }]) => ({
          teamId,
          role: r,
          subRole: r === "member" ? (sr || "developer") : null,
        })
      );

      const res = await fetch(`/api/system/users/${user.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
          "x-org-id": orgId,
        },
        body: JSON.stringify({
          name,
          email,
          role,
          isDeactivated,
          teams: teamsPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        data-testid="edit-user-modal"
        className="w-full max-w-md rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-6 shadow-xl"
      >
        <h3 className="text-sm font-semibold text-[var(--pw-ink)] mb-4">
          Edit User: {user.name}
        </h3>

        {error && (
          <div className="mb-4 rounded bg-red-500/10 border border-red-500/20 p-2 text-xs text-red-500">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-medium text-[var(--pw-ink-secondary)] mb-1">
              Name
            </label>
            <input
              type="text"
              required
              data-testid="edit-user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2 text-[var(--pw-ink)]"
            />
          </div>

          <div>
            <label className="block font-medium text-[var(--pw-ink-secondary)] mb-1">
              Email
            </label>
            <input
              type="email"
              required
              data-testid="edit-user-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2 text-[var(--pw-ink)]"
            />
          </div>

          {/* Organization Admin Toggle */}
          <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3 space-y-1">
            <label className="flex items-center gap-2 cursor-pointer font-medium text-[var(--pw-ink)]">
              <input
                type="checkbox"
                data-testid="edit-user-admin-toggle"
                checked={role === "admin"}
                onChange={(e) => setRole(e.target.checked ? "admin" : "member")}
                className="rounded border-[var(--pw-border)]"
              />
              <span className="font-semibold text-xs">Organization Administrator</span>
            </label>
            <p className="text-[11px] text-[var(--pw-ink-secondary)] pl-5">
              Admin access across all teams, projects, and system configuration. Overrides team roles.
            </p>
          </div>

          {/* Team Memberships Section */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-[var(--pw-ink)] text-xs">
              Team Memberships & Roles
            </label>
            {availableTeams.length === 0 ? (
              <div className="text-[11px] text-[var(--pw-ink-secondary)] italic">
                No teams configured in organization.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-44 overflow-y-auto rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2">
                {availableTeams.map((team) => {
                  const isMember = userTeams.has(team.id);
                  const currentTeamData = userTeams.get(team.id);
                  const currentRole = currentTeamData?.role || "member";
                  const currentSubRole = currentTeamData?.subRole || "developer";
                  return (
                    <div
                      key={team.id}
                      className="flex items-center justify-between gap-2 p-1.5 rounded hover:bg-[var(--pw-surface)]"
                    >
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-[var(--pw-ink)]">
                        <input
                          type="checkbox"
                          data-testid={`team-checkbox-${team.id}`}
                          checked={isMember}
                          onChange={(e) => {
                            const next = new Map(userTeams);
                            if (e.target.checked) {
                              next.set(team.id, { role: "member", subRole: "developer" });
                            } else {
                              next.delete(team.id);
                            }
                            setUserTeams(next);
                          }}
                          className="rounded border-[var(--pw-border)]"
                        />
                        <span>{team.name}</span>
                      </label>

                      {isMember && (
                        <div className="flex items-center gap-1.5">
                          <select
                            data-testid={`team-role-${team.id}`}
                            value={currentRole}
                            onChange={(e) => {
                              const next = new Map(userTeams);
                              const newRole = e.target.value as "lead" | "member" | "viewer";
                              next.set(team.id, {
                                role: newRole,
                                subRole: newRole === "member" ? currentSubRole : null,
                              });
                              setUserTeams(next);
                            }}
                            className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2 py-0.5 text-[11px] font-medium"
                          >
                            <option value="lead">Lead</option>
                            <option value="member">Member</option>
                            <option value="viewer">Viewer</option>
                          </select>

                          {currentRole === "member" && (
                            <select
                              data-testid={`team-subrole-${team.id}`}
                              value={currentSubRole}
                              onChange={(e) => {
                                const next = new Map(userTeams);
                                next.set(team.id, {
                                  role: "member",
                                  subRole: e.target.value,
                                });
                                setUserTeams(next);
                              }}
                              className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--pw-ink-secondary)]"
                            >
                              <option value="developer">Developer</option>
                              <option value="tester">Tester</option>
                              <option value="designer">Designer</option>
                              <option value="devops">DevOps</option>
                              <option value="general">General</option>
                            </select>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer font-medium text-[var(--pw-ink)]">
              <input
                type="checkbox"
                data-testid="edit-user-deactivated"
                checked={isDeactivated}
                onChange={(e) => setIsDeactivated(e.target.checked)}
                className="rounded border-[var(--pw-border)]"
              />
              <span>Deactivate account (blocks login immediately)</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--pw-border)]">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-xs text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              data-testid="edit-user-submit"
              className="rounded bg-[var(--pw-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50"
            >
              {pending ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DeleteUserModal({
  user,
  csrfToken,
  orgId,
  onClose,
  onSuccess,
}: {
  user: UserItem;
  csrfToken: string;
  orgId: string;
  onClose: () => void;
  onSuccess: (action: "deactivated" | "deleted") => void;
}) {
  const [mode, setMode] = useState<"deactivate" | "hard">("deactivate");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [dependencies, setDependencies] = useState<{
    assignedTicketsCount: number;
    reportedTicketsCount: number;
    commentsCount: number;
    attachmentsCount: number;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/system/users/${user.id}`, {
      headers: { "x-org-id": orgId },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.dependencies) setDependencies(d.dependencies);
      })
      .catch(() => undefined);
  }, [user.id, orgId]);

  const handleDelete = async () => {
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/system/users/${user.id}?mode=${mode}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
          "x-org-id": orgId,
        },
        body: JSON.stringify({
          confirmEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      onSuccess(data.action);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        data-testid="delete-user-modal"
        className="w-full max-w-md rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-6 shadow-xl text-xs"
      >
        <h3 className="text-sm font-semibold text-[var(--pw-ink)] mb-2">
          Deactivate or Delete: {user.name}
        </h3>

        {error && (
          <div className="mb-3 rounded bg-red-500/10 border border-red-500/20 p-2 text-xs text-red-500">
            {error}
          </div>
        )}

        {dependencies && (
          <div className="mb-3 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2.5 text-[11px] text-[var(--pw-ink-secondary)] space-y-1">
            <div className="font-semibold text-[var(--pw-ink)]">Dependent Items:</div>
            <div>Assigned tickets: {dependencies.assignedTicketsCount}</div>
            <div>Comments: {dependencies.commentsCount} (preserved as &quot;Deleted user&quot;)</div>
            <div>Attachments: {dependencies.attachmentsCount}</div>
          </div>
        )}

        <div className="space-y-2 mb-4">
          <label className="flex items-start gap-2 cursor-pointer p-2 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)]">
            <input
              type="radio"
              name="deleteMode"
              checked={mode === "deactivate"}
              onChange={() => setMode("deactivate")}
              className="mt-0.5"
            />
            <div>
              <div className="font-semibold text-[var(--pw-ink)]">
                Deactivate User (Recommended)
              </div>
              <div className="text-[11px] text-[var(--pw-ink-secondary)]">
                Blocks login immediately, keeps ticket history and attribution completely intact.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-2 cursor-pointer p-2 rounded border border-red-500/30 bg-red-500/5">
            <input
              type="radio"
              name="deleteMode"
              checked={mode === "hard"}
              onChange={() => setMode("hard")}
              className="mt-0.5"
            />
            <div>
              <div className="font-semibold text-red-600 dark:text-red-400">
                Permanently Delete User
              </div>
              <div className="text-[11px] text-[var(--pw-ink-secondary)]">
                Removes user row. Unassigns tickets. Requires typing email to confirm.
              </div>
            </div>
          </label>
        </div>

        {mode === "hard" && (
          <div className="space-y-1 mb-4">
            <label className="block font-medium text-[var(--pw-ink-secondary)]">
              Type user email <code className="font-mono text-red-600">{user.email}</code> to confirm:
            </label>
            <input
              type="email"
              data-testid="confirm-delete-email"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder={user.email}
              className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2 text-xs text-[var(--pw-ink)]"
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-[var(--pw-border)]">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)]"
          >
            Cancel
          </button>
          <HoldToConfirmButton
            disabled={pending || (mode === "hard" && confirmEmail.toLowerCase() !== user.email.toLowerCase())}
            pending={pending}
            data-testid="confirm-delete-submit"
            onConfirm={handleDelete}
            variant="danger"
            className="rounded px-3 py-1.5 text-xs font-semibold"
            holdLabel={mode === "hard" ? "Holding to delete..." : "Holding to deactivate..."}
          >
            {mode === "hard" ? "Hold to Permanently Delete" : "Hold to Deactivate User"}
          </HoldToConfirmButton>
        </div>
      </div>
    </div>
  );
}

export function ResetPasswordModal({
  user,
  csrfToken,
  onClose,
  onSuccess,
  showToast,
}: {
  user: UserItem;
  csrfToken: string;
  onClose: () => void;
  onSuccess: (password: string) => void;
  showToast: (m: string, t?: "success" | "error") => void;
}) {
  const [passwordOption, setPasswordOption] = useState<"system" | "random">("system");
  const [pending, setPending] = useState(false);

  const handleReset = async () => {
    setPending(true);
    try {
      const res = await fetch(`/api/system/users/${user.id}/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ passwordOption }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      onSuccess(data.generatedPassword);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to reset password", "error");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        data-testid="reset-password-modal"
        className="w-full max-w-sm rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-6 shadow-xl text-xs space-y-4"
      >
        <h3 className="text-sm font-semibold text-[var(--pw-ink)]">
          Reset Password: {user.name}
        </h3>

        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="resetOption"
              checked={passwordOption === "system"}
              onChange={() => setPasswordOption("system")}
            />
            <span>System password (e.g. <code>PriyaS@4821</code>)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="resetOption"
              checked={passwordOption === "random"}
              onChange={() => setPasswordOption("random")}
            />
            <span>Cryptographically random 16-character password</span>
          </label>
        </div>

        <p className="text-[11px] text-[var(--pw-ink-tertiary)]">
          All active sessions for this user will be terminated immediately.
        </p>

        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--pw-border)]">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            data-testid="confirm-reset-pass-submit"
            onClick={handleReset}
            className="rounded bg-[var(--pw-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)]"
          >
            {pending ? "Resetting..." : "Reset Password"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ImportCsvModal({
  csrfToken,
  orgId,
  onClose,
  onSuccess,
  showToast,
}: {
  csrfToken: string;
  orgId: string;
  onClose: () => void;
  onSuccess: (res: {
    importedCount: number;
    skippedRows?: Array<{ row: number; email: string; reason: string }>;
  }) => void;
  showToast: (m: string, t?: "success" | "error") => void;
}) {
  const [csvText, setCsvText] = useState("");
  const [pending, setPending] = useState(false);
  const [skipped, setSkipped] = useState<Array<{ row: number; email: string; reason: string }> | null>(null);

  const handleImport = async () => {
    if (!csvText.trim()) return;
    setPending(true);
    try {
      const res = await fetch("/api/system/users/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
          "x-org-id": orgId,
        },
        body: JSON.stringify({ csv: csvText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      if (data.skippedRows && data.skippedRows.length > 0) {
        setSkipped(data.skippedRows);
      } else {
        onSuccess(data);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Import failed", "error");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        data-testid="import-csv-modal"
        className="w-full max-w-lg rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-6 shadow-xl text-xs space-y-4"
      >
        <h3 className="text-sm font-semibold text-[var(--pw-ink)]">
          Import Users from CSV
        </h3>

        {skipped ? (
          <div className="space-y-3">
            <div className="rounded bg-amber-500/10 border border-amber-500/30 p-2 text-xs text-amber-700 dark:text-amber-400">
              Valid rows were imported. The following {skipped.length} duplicate rows were skipped:
            </div>
            <div className="max-h-48 overflow-y-auto rounded border border-[var(--pw-border)] p-2 divide-y divide-[var(--pw-border)] text-[11px]">
              {skipped.map((s, idx) => (
                <div key={idx} className="py-1 flex justify-between">
                  <span>Line {s.row}: <strong>{s.email}</strong></span>
                  <span className="text-[var(--pw-ink-tertiary)]">{s.reason}</span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onSuccess({ importedCount: 0, skippedRows: skipped })}
              className="w-full rounded bg-[var(--pw-accent)] p-2 text-xs font-semibold text-white"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div>
              <label className="block font-medium text-[var(--pw-ink-secondary)] mb-1">
                Paste CSV content:
              </label>
              <textarea
                rows={6}
                data-testid="import-csv-textarea"
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder="Name,Email,Role,Teams&#10;Ada Lovelace,ada@acme.dev,admin,Core&#10;Charles Babbage,charles@acme.dev,member,Core"
                className="w-full font-mono text-[11px] rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--pw-border)]">
              <button
                type="button"
                onClick={onClose}
                className="rounded px-3 py-1.5 text-xs text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || !csvText.trim()}
                data-testid="import-csv-submit"
                onClick={handleImport}
                className="rounded bg-[var(--pw-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50"
              >
                {pending ? "Importing..." : "Import Users"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ==========================================
// SECTION B: ORGANIZATION
// ==========================================
