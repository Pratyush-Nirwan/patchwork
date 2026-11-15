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
import { HoldToConfirmButton } from "./HoldToConfirmButton";
import { UserRoleBadges } from "./UserRoleBadges";
import { AddUserModal, EditUserModal, DeleteUserModal, ResetPasswordModal, ImportCsvModal } from "./UserModals";
import type { TeamHierarchyItem, UserItem } from "./types";

export function UsersSection({
  orgId,
  csrfToken,
  showToast,
}: {
  orgId: string;
  csrfToken: string;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [availableTeams, setAvailableTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortField, setSortField] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingUser, setDeletingUser] = useState<UserItem | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordTargetUser, setPasswordTargetUser] = useState<UserItem | null>(null);
  const [generatedPasswordNotice, setGeneratedPasswordNotice] = useState<{
    password: string;
    userName: string;
  } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search,
        role: roleFilter,
        teamId: teamFilter,
        status: statusFilter,
        sort: sortField,
        order: sortOrder,
        pageSize: "100",
      });
      if (orgId) params.set("orgId", orgId);
      const res = await fetch(`/api/system/users?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUsers(data.users || []);
      if (data.availableTeams) setAvailableTeams(data.availableTeams);
      setTotal(data.total || 0);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load users", "error");
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, teamFilter, statusFilter, sortField, sortOrder, orgId, showToast]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const toggleSelectAll = () => {
    if (selectedIds.size === users.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(users.map((u) => u.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkAction = async (action: string, extra?: Record<string, unknown>) => {
    if (selectedIds.size === 0) return;
    try {
      const res = await fetch("/api/system/users/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
          "x-org-id": orgId,
        },
        body: JSON.stringify({
          userIds: Array.from(selectedIds),
          action,
          ...extra,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`Bulk ${action} completed: ${data.affectedCount} users updated`);
      setSelectedIds(new Set());
      loadUsers();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Bulk action failed", "error");
    }
  };

  const handleForceSignOut = async (userId: string) => {
    try {
      const res = await fetch(`/api/system/users/${userId}/force-signout`, {
        method: "POST",
        headers: { "x-csrf-token": csrfToken, "x-org-id": orgId },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast("User sessions revoked successfully");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Sign-out failed", "error");
    }
  };

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--pw-border)] pb-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--pw-ink)]">
            Users & Access Management
          </h2>
          <p className="text-xs text-[var(--pw-ink-secondary)]">
            Total {total} users in organization. Manage credentials, status, and permissions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/api/system/users/export"
            download="users.csv"
            data-testid="export-users-csv"
            className="flex items-center gap-1.5 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--pw-ink)] hover:bg-[var(--pw-surface-muted)] transition"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </a>
          <button
            type="button"
            data-testid="import-users-csv-btn"
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1.5 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--pw-ink)] hover:bg-[var(--pw-surface-muted)] transition"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Import CSV</span>
          </button>
          <button
            type="button"
            data-testid="add-user-btn"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded bg-[var(--pw-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] transition"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add User</span>
          </button>
        </div>
      </div>

      {/* Generated Password Announcement Banner */}
      {generatedPasswordNotice && (
        <div
          data-testid="password-generated-banner"
          className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-[var(--pw-ink)] flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-amber-500 shrink-0" />
            <span>
              Initial password for <strong>{generatedPasswordNotice.userName}</strong>:{" "}
              <code className="font-mono font-semibold bg-[var(--pw-surface)] px-1.5 py-0.5 rounded border border-[var(--pw-border)]">
                {generatedPasswordNotice.password}
              </code>{" "}
              (Copied / reveal once. User will be forced to change it on first login).
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(generatedPasswordNotice.password);
                showToast("Password copied to clipboard");
              }}
              className="rounded bg-[var(--pw-surface)] px-2 py-1 text-xs font-medium border border-[var(--pw-border)] hover:bg-[var(--pw-surface-muted)]"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setGeneratedPasswordNotice(null)}
              className="rounded p-1 text-[var(--pw-ink-tertiary)] hover:text-[var(--pw-ink)]"
            >
              <XCircle className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--pw-ink-tertiary)]" />
            <input
              type="text"
              data-testid="users-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email..."
              className="h-8 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] pl-8 pr-3 text-xs text-[var(--pw-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--pw-accent)]"
            />
          </div>

          <select
            data-testid="users-role-filter"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-8 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2 text-xs text-[var(--pw-ink)]"
          >
            <option value="all">All Roles</option>
            <option value="admin">Admin</option>
            <option value="lead">Lead</option>
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </select>

          <select
            data-testid="users-team-filter"
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="h-8 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2 text-xs text-[var(--pw-ink)]"
          >
            <option value="all">All Teams</option>
            {availableTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <select
            data-testid="users-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2 text-xs text-[var(--pw-ink)]"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="deactivated">Deactivated</option>
          </select>
        </div>

        {/* Bulk action buttons */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium text-[var(--pw-ink-secondary)]">
              {selectedIds.size} selected:
            </span>
            <HoldToConfirmButton
              data-testid="bulk-deactivate-btn"
              variant="danger"
              onConfirm={() => handleBulkAction("deactivate")}
              className="rounded px-2.5 py-1 text-xs font-medium"
              holdLabel="Holding..."
            >
              Hold to Deactivate
            </HoldToConfirmButton>
            <button
              type="button"
              data-testid="bulk-signout-btn"
              onClick={() => handleBulkAction("force-signout")}
              className="rounded bg-[var(--pw-surface-muted)] px-2 py-1 font-medium text-[var(--pw-ink)] hover:bg-[var(--pw-border)]"
            >
              Force Sign-out
            </button>
          </div>
        )}
      </div>

      {/* Users Table (Dense Jira Style) */}
      <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[var(--pw-border)] bg-[var(--pw-surface-muted)] text-[var(--pw-ink-secondary)]">
              <th className="py-2 px-3 w-8">
                <input
                  type="checkbox"
                  checked={users.length > 0 && selectedIds.size === users.length}
                  onChange={toggleSelectAll}
                  className="rounded border-[var(--pw-border)]"
                />
              </th>
              <th className="py-2 px-3 font-semibold">Name</th>
              <th className="py-2 px-3 font-semibold">Email</th>
              <th
                data-testid="sort-by-role"
                onClick={() => {
                  if (sortField === "role") {
                    setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
                  } else {
                    setSortField("role");
                    setSortOrder("desc");
                  }
                }}
                className="py-2 px-3 font-semibold cursor-pointer select-none hover:text-[var(--pw-ink)]"
              >
                <div className="flex items-center gap-1">
                  <span>Role</span>
                  {sortField === "role" && (
                    <span className="text-[10px]">{sortOrder === "asc" ? "▲" : "▼"}</span>
                  )}
                </div>
              </th>
              <th className="py-2 px-3 font-semibold">Status</th>
              <th className="py-2 px-3 font-semibold">Last Login</th>
              <th className="py-2 px-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--pw-border)]">
            {loading ? (
              Array.from({ length: 4 }).map((_, rIdx) => (
                <tr key={rIdx} aria-hidden="true">
                  <td colSpan={7} className="px-3 py-2.5">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ))
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-[var(--pw-ink-secondary)]">
                  No users found matching filters.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr
                  key={u.id}
                  data-testid={`user-row-${u.email}`}
                  className="hover:bg-[var(--pw-surface-muted)] transition"
                >
                  <td className="py-2 px-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(u.id)}
                      onChange={() => toggleSelect(u.id)}
                      className="rounded border-[var(--pw-border)]"
                    />
                  </td>
                  <td className="py-2 px-3 font-medium text-[var(--pw-ink)]">
                    {u.name}
                  </td>
                  <td className="py-2 px-3 font-mono text-[11px] text-[var(--pw-ink-secondary)]">
                    {u.email}
                  </td>
                  <td className="py-2 px-3">
                    <UserRoleBadges role={u.role} teams={u.teams} />
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className={`text-xs font-medium ${u.status === "active"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
                        }`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-[var(--pw-ink-tertiary)] font-mono text-[11px]">
                    {u.lastLoginAt
                      ? new Date(u.lastLoginAt).toLocaleDateString()
                      : "Never"}
                  </td>
                  <td className="py-2 px-3 text-right space-x-1">
                    <button
                      type="button"
                      data-testid={`edit-user-${u.id}`}
                      onClick={() => {
                        setEditingUser(u);
                        setShowEditModal(true);
                      }}
                      className="rounded p-1 text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)] hover:text-[var(--pw-ink)]"
                      title="Edit user"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      data-testid={`reset-pass-user-${u.id}`}
                      onClick={() => {
                        setPasswordTargetUser(u);
                        setShowPasswordModal(true);
                      }}
                      className="rounded p-1 text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)] hover:text-[var(--pw-ink)]"
                      title="Reset password"
                    >
                      <Key className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      data-testid={`signout-user-${u.id}`}
                      onClick={() => handleForceSignOut(u.id)}
                      className="rounded p-1 text-[var(--pw-ink-secondary)] hover:bg-[var(--pw-surface-muted)] hover:text-[var(--pw-ink)]"
                      title="Force sign-out"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      data-testid={`delete-user-${u.id}`}
                      onClick={() => {
                        setDeletingUser(u);
                        setShowDeleteModal(true);
                      }}
                      className="rounded p-1 text-red-600 hover:text-red-700 hover:bg-red-500/10 dark:text-red-400 dark:hover:text-red-300"
                      title="Deactivate or Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <AddUserModal
          orgId={orgId}
          csrfToken={csrfToken}
          onClose={() => setShowAddModal(false)}
          onSuccess={(created) => {
            setShowAddModal(false);
            setGeneratedPasswordNotice({
              userName: created.user.name,
              password: created.generatedPassword,
            });
            showToast(`User ${created.user.name} created successfully`);
            loadUsers();
          }}
        />
      )}

      {/* Edit User Modal */}
      {showEditModal && editingUser && (
        <EditUserModal
          user={editingUser}
          availableTeams={availableTeams}
          csrfToken={csrfToken}
          orgId={orgId}
          onClose={() => {
            setShowEditModal(false);
            setEditingUser(null);
          }}
          onSuccess={() => {
            setShowEditModal(false);
            setEditingUser(null);
            showToast("User updated successfully");
            loadUsers();
          }}
        />
      )}

      {/* Delete / Deactivate User Modal */}
      {showDeleteModal && deletingUser && (
        <DeleteUserModal
          user={deletingUser}
          csrfToken={csrfToken}
          orgId={orgId}
          onClose={() => {
            setShowDeleteModal(false);
            setDeletingUser(null);
          }}
          onSuccess={(action) => {
            setShowDeleteModal(false);
            setDeletingUser(null);
            showToast(`User ${action === "deleted" ? "permanently deleted" : "deactivated"}`);
            loadUsers();
          }}
        />
      )}

      {/* Reset Password Modal */}
      {showPasswordModal && passwordTargetUser && (
        <ResetPasswordModal
          user={passwordTargetUser}
          csrfToken={csrfToken}
          onClose={() => {
            setShowPasswordModal(false);
            setPasswordTargetUser(null);
          }}
          onSuccess={(newPass) => {
            setShowPasswordModal(false);
            setGeneratedPasswordNotice({
              userName: passwordTargetUser.name,
              password: newPass,
            });
            showToast("Password reset successfully");
          }}
          showToast={showToast}
        />
      )}

      {/* CSV Import Modal */}
      {showImportModal && (
        <ImportCsvModal
          csrfToken={csrfToken}
          orgId={orgId}
          onClose={() => setShowImportModal(false)}
          onSuccess={(res) => {
            setShowImportModal(false);
            showToast(`Imported ${res.importedCount} users (${res.skippedRows?.length || 0} skipped)`);
            loadUsers();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// User Action Modals
