"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Check,
  Copy,
  KeyRound,
  Mail,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  Webhook,
} from "lucide-react";
import { SystemSectionSkeleton } from "@/components/skeletons/SystemConfigSkeleton";
import { Skeleton, Surface } from "@/components/ui/skeleton";

interface NotificationsAdminSettings {
  defaultTimezone: string;
  retentionReadDays: number;
  retentionUnreadCap: number;
  deliveryLogRetentionDays: number;
  presenceEnabled: boolean;
  includeTicketTextInEmails: boolean;
  allowPrivateNetworkWebhooks: boolean;
  smtp: {
    enabled: boolean;
    host: string;
    port: number;
    security: "none" | "starttls" | "tls";
    username: string;
    fromName: string;
    fromAddress: string;
    replyTo: string;
    hasPassword?: boolean;
    passwordMasked?: string | null;
  };
}

interface WebhookEndpointItem {
  id: string;
  name: string;
  url: string;
  format: "generic" | "slack" | "discord" | "mattermost";
  events: string[];
  enabled: boolean;
  consecutiveFailures: number;
  disabledReason: string | null;
}

interface EmailLogItem {
  id: string;
  recipientMasked: string;
  category: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

interface WebhookDeliveryItem {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  durationMs: number | null;
  lastError: string | null;
  createdAt: string;
}

const ALL_WEBHOOK_EVENTS = [
  "ticket.created",
  "ticket.updated",
  "ticket.moved",
  "ticket.assigned",
  "comment.created",
  "mention",
];

export function NotificationsSection({
  csrfToken,
  showToast,
}: {
  csrfToken: string;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [subTab, setSubTab] = useState<"general" | "email" | "webhooks">("general");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<NotificationsAdminSettings | null>(null);
  const [smtpPassword, setSmtpPassword] = useState("");
  const [testEmailTo, setTestEmailTo] = useState("");
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [emailLogs, setEmailLogs] = useState<EmailLogItem[]>([]);
  const [emailLogsLoading, setEmailLogsLoading] = useState(false);

  // Webhooks state
  const [endpoints, setEndpoints] = useState<WebhookEndpointItem[]>([]);
  const [newWhName, setNewWhName] = useState("");
  const [newWhUrl, setNewWhUrl] = useState("");
  const [newWhFormat, setNewWhFormat] = useState<"generic" | "slack" | "discord" | "mattermost">("generic");
  const [newWhEvents, setNewWhEvents] = useState<string[]>(["ticket.created", "comment.created", "mention"]);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryItem[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [setRes, whRes] = await Promise.all([
        fetch("/api/system/settings/notifications"),
        fetch("/api/system/notifications/webhooks"),
      ]);
      if (setRes.ok) {
        const d = await setRes.json();
        setSettings(d.settings);
        setSmtpPassword(d.settings?.smtp?.passwordMasked || "");
      }
      if (whRes.ok) {
        const d = await whRes.json();
        setEndpoints(d.endpoints || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const loadEmailLogs = async () => {
    setEmailLogsLoading(true);
    try {
      const res = await fetch("/api/system/notifications/email-logs?limit=30");
      if (res.ok) {
        const d = await res.json();
        setEmailLogs(d.logs || []);
      }
    } finally {
      setEmailLogsLoading(false);
    }
  };

  const loadDeliveries = async (endpointId: string) => {
    setSelectedEndpointId(endpointId);
    setDeliveriesLoading(true);
    try {
      const res = await fetch(`/api/system/notifications/webhooks/${endpointId}/deliveries`);
      if (res.ok) {
        const d = await res.json();
        setDeliveries(d.deliveries || []);
      }
    } finally {
      setDeliveriesLoading(false);
    }
  };

  const handleSaveSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch("/api/system/settings/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({
          ...settings,
          smtp: {
            ...settings.smtp,
            password: smtpPassword,
          },
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to save notification settings");
      setSettings(d.settings);
      setSmtpPassword(d.settings?.smtp?.passwordMasked || "");
      showToast("Notification settings saved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleResetSettings = async () => {
    const res = await fetch("/api/system/settings/notifications", {
      method: "DELETE",
      headers: { "x-csrf-token": csrfToken },
    });
    if (res.ok) {
      await loadAll();
      showToast("Notification settings reset to defaults", "info");
    }
  };

  const handleSendTestEmail = async () => {
    setTestEmailResult(null);
    const res = await fetch("/api/system/notifications/test-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ to: testEmailTo.trim() || undefined }),
    });
    const d = await res.json();
    setTestEmailResult({
      ok: Boolean(d.ok),
      msg: d.ok ? "Test email sent successfully." : d.error || "Failed to send test email",
    });
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/system/notifications/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({
          name: newWhName,
          url: newWhUrl,
          format: newWhFormat,
          events: newWhEvents,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to create webhook");
      setRevealedSecret(d.secret);
      setNewWhName("");
      setNewWhUrl("");
      await loadAll();
      showToast("Webhook created — copy the signing secret now", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to create webhook", "error");
    }
  };

  const handleRotateSecret = async (endpointId: string) => {
    const res = await fetch(`/api/system/notifications/webhooks/${endpointId}/rotate`, {
      method: "POST",
      headers: { "x-csrf-token": csrfToken },
    });
    const d = await res.json();
    if (res.ok && d.secret) {
      setRevealedSecret(d.secret);
      showToast("Signing secret rotated — copy it now", "info");
    }
  };

  const handleToggleEndpoint = async (ep: WebhookEndpointItem) => {
    await fetch(`/api/system/notifications/webhooks/${ep.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ enabled: !ep.enabled }),
    });
    await loadAll();
  };

  const handleDeleteEndpoint = async (id: string) => {
    await fetch(`/api/system/notifications/webhooks/${id}`, {
      method: "DELETE",
      headers: { "x-csrf-token": csrfToken },
    });
    if (selectedEndpointId === id) {
      setSelectedEndpointId(null);
      setDeliveries([]);
    }
    await loadAll();
  };

  const handleTestWebhook = async (id: string) => {
    const res = await fetch(`/api/system/notifications/webhooks/${id}/test`, {
      method: "POST",
      headers: { "x-csrf-token": csrfToken },
    });
    const d = await res.json();
    showToast(
      d.ok ? `Test webhook delivered (HTTP ${d.statusCode})` : `Test webhook failed: ${d.error}`,
      d.ok ? "success" : "error"
    );
    await loadDeliveries(id);
  };

  const handleRetryDelivery = async (endpointId: string, deliveryId: string) => {
    await fetch(`/api/system/notifications/webhooks/${endpointId}/deliveries`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ deliveryId }),
    });
    showToast("Retry queued", "info");
    await loadDeliveries(endpointId);
  };

  if (loading || !settings) return <SystemSectionSkeleton />;

  return (
    <div className="space-y-6" data-testid="system-notifications-section">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--pw-border)] pb-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--pw-ink)]">
            Notifications, Email & Webhooks
          </h2>
          <p className="text-xs text-[var(--pw-ink-secondary)]">
            Configure digest time zone, retention, optional SMTP delivery, presence privacy, and outbound webhooks.
          </p>
        </div>

        <div className="flex gap-1 rounded-lg border border-[var(--pw-border)] bg-[var(--pw-bg)] p-1">
          {(
            [
              { id: "general", label: "General & Privacy", icon: Bell },
              { id: "email", label: "Email (SMTP)", icon: Mail },
              { id: "webhooks", label: "Webhooks", icon: Webhook },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              data-testid={`notifications-subtab-${id}`}
              onClick={() => {
                setSubTab(id);
                if (id === "email") loadEmailLogs();
              }}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition ${
                subTab === id
                  ? "bg-[var(--pw-surface)] text-[var(--pw-ink)] shadow-xs"
                  : "text-[var(--pw-ink-secondary)] hover:text-[var(--pw-ink)]"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {subTab === "general" && (
        <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4">
            <label className="space-y-1">
              <span className="font-medium text-[var(--pw-ink)]">Org default time zone (for digests)</span>
              <input
                type="text"
                data-testid="notif-timezone-input"
                value={settings.defaultTimezone}
                onChange={(e) => setSettings({ ...settings, defaultTimezone: e.target.value })}
                placeholder="UTC or America/New_York"
                className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 font-mono text-xs"
              />
            </label>

            <label className="space-y-1">
              <span className="font-medium text-[var(--pw-ink)]">Read notification retention (days)</span>
              <input
                type="number"
                min={1}
                max={3650}
                value={settings.retentionReadDays}
                onChange={(e) =>
                  setSettings({ ...settings, retentionReadDays: Number(e.target.value) || 90 })
                }
                className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 font-mono text-xs"
              />
            </label>

            <label className="space-y-1">
              <span className="font-medium text-[var(--pw-ink)]">Unread notifications cap per user</span>
              <input
                type="number"
                min={50}
                max={10000}
                value={settings.retentionUnreadCap}
                onChange={(e) =>
                  setSettings({ ...settings, retentionUnreadCap: Number(e.target.value) || 500 })
                }
                className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 font-mono text-xs"
              />
            </label>

            <label className="space-y-1">
              <span className="font-medium text-[var(--pw-ink)]">Delivery log retention (days)</span>
              <input
                type="number"
                min={1}
                max={365}
                value={settings.deliveryLogRetentionDays}
                onChange={(e) =>
                  setSettings({ ...settings, deliveryLogRetentionDays: Number(e.target.value) || 30 })
                }
                className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 font-mono text-xs"
              />
            </label>
          </div>

          <div className="space-y-2 rounded-lg border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <div>
                <div className="font-medium text-[var(--pw-ink)]">Enable real-time presence and typing indicators</div>
                <div className="text-[11px] text-[var(--pw-ink-muted)]">
                  When disabled, no viewer avatars or typing indicators are broadcast anywhere.
                </div>
              </div>
              <input
                type="checkbox"
                data-testid="org-presence-toggle"
                checked={settings.presenceEnabled}
                onChange={(e) => setSettings({ ...settings, presenceEnabled: e.target.checked })}
              />
            </label>

            <label className="flex items-center justify-between gap-3 cursor-pointer border-t border-[var(--pw-border)] pt-2">
              <div>
                <div className="font-medium text-[var(--pw-ink)]">Include ticket text snippets in emails</div>
                <div className="text-[11px] text-[var(--pw-ink-muted)]">
                  Off by default for stricter privacy; emails include only ticket key, title, and link.
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.includeTicketTextInEmails}
                onChange={(e) =>
                  setSettings({ ...settings, includeTicketTextInEmails: e.target.checked })
                }
              />
            </label>

            <label className="flex items-center justify-between gap-3 cursor-pointer border-t border-[var(--pw-border)] pt-2">
              <div>
                <div className="font-medium text-[var(--pw-ink)]">
                  Allow webhooks to private network addresses
                </div>
                <div className="text-[11px] text-amber-800 dark:text-amber-400">
                  Warning: Enables HTTP and RFC1918/loopback targets for self-hosted Mattermost/intranet receivers. Keep off on shared hosts.
                </div>
              </div>
              <input
                type="checkbox"
                data-testid="allow-private-webhooks-toggle"
                checked={settings.allowPrivateNetworkWebhooks}
                onChange={(e) =>
                  setSettings({ ...settings, allowPrivateNetworkWebhooks: e.target.checked })
                }
              />
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              data-testid="save-notif-settings-btn"
              className="rounded bg-[var(--pw-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)]"
            >
              {saving ? "Saving..." : "Save settings"}
            </button>
            <button
              type="button"
              onClick={handleResetSettings}
              className="inline-flex items-center gap-1 rounded border border-[var(--pw-border)] px-3 py-1.5 text-xs hover:bg-[var(--pw-surface-hover)]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset defaults</span>
            </button>
          </div>
        </form>
      )}

      {subTab === "email" && (
        <div className="space-y-6 text-xs">
          <form onSubmit={handleSaveSettings} className="space-y-4 rounded-lg border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4">
            <label className="flex items-center justify-between">
              <span className="font-semibold text-[var(--pw-ink)]">Enable outbound SMTP email</span>
              <input
                type="checkbox"
                data-testid="smtp-enabled-toggle"
                checked={settings.smtp.enabled}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    smtp: { ...settings.smtp, enabled: e.target.checked },
                  })
                }
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="space-y-1 sm:col-span-2">
                <span>SMTP Host</span>
                <input
                  type="text"
                  data-testid="smtp-host-input"
                  value={settings.smtp.host}
                  onChange={(e) =>
                    setSettings({ ...settings, smtp: { ...settings.smtp, host: e.target.value } })
                  }
                  placeholder="smtp.example.com"
                  className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 font-mono"
                />
              </label>
              <label className="space-y-1">
                <span>Port</span>
                <input
                  type="number"
                  data-testid="smtp-port-input"
                  value={settings.smtp.port}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      smtp: { ...settings.smtp, port: Number(e.target.value) || 587 },
                    })
                  }
                  className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 font-mono"
                />
              </label>
              <label className="space-y-1">
                <span>Security</span>
                <select
                  data-testid="smtp-security-select"
                  value={settings.smtp.security}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      smtp: {
                        ...settings.smtp,
                        security: e.target.value as "none" | "starttls" | "tls",
                      },
                    })
                  }
                  className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5"
                >
                  <option value="none">None (local relay)</option>
                  <option value="starttls">STARTTLS (587)</option>
                  <option value="tls">TLS / SSL (465)</option>
                </select>
              </label>
              <label className="space-y-1">
                <span>Username</span>
                <input
                  type="text"
                  value={settings.smtp.username}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      smtp: { ...settings.smtp, username: e.target.value },
                    })
                  }
                  className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 font-mono"
                />
              </label>
              <label className="space-y-1">
                <span>Password (write-only, encrypted)</span>
                <input
                  type="password"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  placeholder={settings.smtp.hasPassword ? "••••••••" : "Optional"}
                  className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 font-mono"
                />
              </label>
              <label className="space-y-1">
                <span>From Name</span>
                <input
                  type="text"
                  value={settings.smtp.fromName}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      smtp: { ...settings.smtp, fromName: e.target.value },
                    })
                  }
                  className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5"
                />
              </label>
              <label className="space-y-1">
                <span>From Address</span>
                <input
                  type="email"
                  data-testid="smtp-from-input"
                  value={settings.smtp.fromAddress}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      smtp: { ...settings.smtp, fromAddress: e.target.value },
                    })
                  }
                  placeholder="notifications@example.com"
                  className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 font-mono"
                />
              </label>
              <label className="space-y-1">
                <span>Reply-To</span>
                <input
                  type="email"
                  value={settings.smtp.replyTo}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      smtp: { ...settings.smtp, replyTo: e.target.value },
                    })
                  }
                  placeholder="Optional"
                  className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 font-mono"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                data-testid="save-smtp-btn"
                className="rounded bg-[var(--pw-accent)] px-3 py-1.5 font-semibold text-white hover:bg-[var(--pw-accent-hover)]"
              >
                {saving ? "Saving..." : "Save SMTP settings"}
              </button>

              <div className="flex items-center gap-2">
                <input
                  type="email"
                  data-testid="test-email-to-input"
                  value={testEmailTo}
                  onChange={(e) => setTestEmailTo(e.target.value)}
                  placeholder="Recipient (defaults to your email)"
                  className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 font-mono"
                />
                <button
                  type="button"
                  data-testid="send-test-email-btn"
                  onClick={handleSendTestEmail}
                  className="inline-flex items-center gap-1 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-1.5 font-medium hover:bg-[var(--pw-surface-hover)]"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Send test email</span>
                </button>
              </div>
            </div>

            {testEmailResult && (
              <div
                data-testid="test-email-result"
                className={`rounded border px-3 py-2 ${
                  testEmailResult.ok
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
                }`}
              >
                {testEmailResult.msg}
              </div>
            )}
          </form>

          <div className="rounded-lg border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[var(--pw-ink)]">Email Delivery Log</h3>
              <button
                type="button"
                onClick={loadEmailLogs}
                className="inline-flex items-center gap-1 text-[11px] text-[var(--pw-ink-secondary)] hover:text-[var(--pw-ink)]"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Refresh</span>
              </button>
            </div>
            {emailLogsLoading && emailLogs.length === 0 ? (
              <Surface variant="surface" className="space-y-2 py-2" aria-busy="true" aria-label="Loading email delivery logs">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="grid grid-cols-5 gap-3 py-1">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-3 w-8" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                ))}
              </Surface>
            ) : emailLogs.length === 0 ? (
              <p className="text-[var(--pw-ink-muted)]">No email deliveries recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--pw-border)] text-[11px] text-[var(--pw-ink-muted)]">
                      <th className="py-1.5 pr-3">Recipient</th>
                      <th className="py-1.5 pr-3">Category</th>
                      <th className="py-1.5 pr-3">Status</th>
                      <th className="py-1.5 pr-3">Attempts</th>
                      <th className="py-1.5">Last Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--pw-border)] font-mono text-[11px]">
                    {emailLogs.map((l) => (
                      <tr key={l.id}>
                        <td className="py-1.5 pr-3">{l.recipientMasked}</td>
                        <td className="py-1.5 pr-3">{l.category}</td>
                        <td className="py-1.5 pr-3">{l.status}</td>
                        <td className="py-1.5 pr-3">{l.attempts}</td>
                        <td className="py-1.5 text-red-500">{l.lastError || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === "webhooks" && (
        <div className="space-y-6 text-xs">
          {revealedSecret && (
            <div
              data-testid="webhook-secret-reveal"
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2"
            >
              <div className="font-semibold text-[var(--pw-ink)]">
                Signing secret (shown once — copy and store it safely):
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-[var(--pw-bg)] px-2.5 py-1.5 font-mono text-[11px]">
                  {revealedSecret}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(revealedSecret);
                    setCopiedSecret(true);
                    setTimeout(() => setCopiedSecret(false), 2000);
                  }}
                  className="inline-flex items-center gap-1 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-2.5 py-1.5"
                >
                  {copiedSecret ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedSecret ? "Copied" : "Copy"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRevealedSecret(null)}
                  className="text-[11px] underline"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <form
            onSubmit={handleCreateWebhook}
            className="space-y-3 rounded-lg border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4"
          >
            <h3 className="font-semibold text-[var(--pw-ink)]">Add Webhook Endpoint</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                required
                data-testid="webhook-name-input"
                value={newWhName}
                onChange={(e) => setNewWhName(e.target.value)}
                placeholder="Endpoint name (e.g. Engineering Slack)"
                className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5"
              />
              <input
                type="url"
                required
                data-testid="webhook-url-input"
                value={newWhUrl}
                onChange={(e) => setNewWhUrl(e.target.value)}
                placeholder="https://hooks.example.com/..."
                className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5 font-mono"
              />
              <select
                data-testid="webhook-format-select"
                value={newWhFormat}
                onChange={(e) =>
                  setNewWhFormat(e.target.value as "generic" | "slack" | "discord" | "mattermost")
                }
                className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1.5"
              >
                <option value="generic">Generic JSON (v1)</option>
                <option value="slack">Slack Incoming Webhook</option>
                <option value="discord">Discord Webhook</option>
                <option value="mattermost">Mattermost Webhook</option>
              </select>
            </div>

            <div className="flex flex-wrap gap-3">
              {ALL_WEBHOOK_EVENTS.map((ev) => (
                <label key={ev} className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={newWhEvents.includes(ev)}
                    onChange={(e) =>
                      setNewWhEvents((prev) =>
                        e.target.checked ? [...prev, ev] : prev.filter((x) => x !== ev)
                      )
                    }
                  />
                  <span className="font-mono text-[11px]">{ev}</span>
                </label>
              ))}
            </div>

            <button
              type="submit"
              data-testid="create-webhook-btn"
              className="inline-flex items-center gap-1.5 rounded bg-[var(--pw-accent)] px-3 py-1.5 font-semibold text-white hover:bg-[var(--pw-accent-hover)]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create webhook</span>
            </button>
          </form>

          <div className="space-y-3">
            {endpoints.map((ep) => (
              <div
                key={ep.id}
                data-testid={`webhook-item-${ep.id}`}
                className="rounded-lg border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[var(--pw-ink)]">{ep.name}</span>
                      <span className="rounded bg-[var(--pw-surface-muted)] px-1.5 py-0.5 font-mono text-[10px] uppercase">
                        {ep.format}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          ep.enabled
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "bg-slate-500/10 text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        {ep.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-[var(--pw-ink-muted)]">
                      {ep.url}
                    </div>
                    {ep.disabledReason && (
                      <div className="mt-1 text-[11px] text-amber-800 dark:text-amber-400">
                        {ep.disabledReason}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleTestWebhook(ep.id)}
                      className="rounded border border-[var(--pw-border)] px-2 py-1 hover:bg-[var(--pw-surface-hover)]"
                    >
                      Send test
                    </button>
                    <button
                      type="button"
                      onClick={() => loadDeliveries(ep.id)}
                      className="rounded border border-[var(--pw-border)] px-2 py-1 hover:bg-[var(--pw-surface-hover)]"
                    >
                      Delivery log
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRotateSecret(ep.id)}
                      className="inline-flex items-center gap-1 rounded border border-[var(--pw-border)] px-2 py-1 hover:bg-[var(--pw-surface-hover)]"
                    >
                      <KeyRound className="h-3 w-3" />
                      <span>Rotate secret</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleEndpoint(ep)}
                      className="rounded border border-[var(--pw-border)] px-2 py-1 hover:bg-[var(--pw-surface-hover)]"
                    >
                      {ep.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete webhook ${ep.name}`}
                      onClick={() => handleDeleteEndpoint(ep.id)}
                      className="rounded border border-red-500/30 px-2 py-1 text-red-500 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {selectedEndpointId === ep.id && (
                  <div className="mt-3 border-t border-[var(--pw-border)] pt-3 space-y-2">
                    <div className="font-semibold text-[11px] text-[var(--pw-ink)]">
                      Recent Deliveries
                    </div>
                    {deliveriesLoading && deliveries.length === 0 ? (
                      <Surface variant="surface" className="space-y-1.5" aria-busy="true" aria-label="Loading webhook deliveries">
                        {[0, 1, 2].map((i) => (
                          <Surface key={i} variant="card" className="flex items-center justify-between gap-2 rounded bg-[var(--pw-bg)] px-2.5 py-2">
                            <Skeleton className="h-3 w-48" />
                            <Skeleton className="h-3 w-14" />
                          </Surface>
                        ))}
                      </Surface>
                    ) : deliveries.length === 0 ? (
                      <p className="text-[11px] text-[var(--pw-ink-muted)]">No deliveries yet.</p>
                    ) : (
                      <div className="space-y-1 font-mono text-[11px]">
                        {deliveries.map((del) => (
                          <div
                            key={del.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded bg-[var(--pw-bg)] px-2.5 py-1.5"
                          >
                            <span>
                              {del.eventType} · {del.status}
                              {del.responseStatus ? ` (${del.responseStatus})` : ""}
                              {del.durationMs != null ? ` · ${del.durationMs}ms` : ""}
                            </span>
                            <div className="flex items-center gap-2">
                              {del.lastError && (
                                <span className="text-red-500">{del.lastError}</span>
                              )}
                              {(del.status === "failed" || del.status === "dead_letter") && (
                                <button
                                  type="button"
                                  onClick={() => handleRetryDelivery(ep.id, del.id)}
                                  className="underline text-[var(--pw-accent)]"
                                >
                                  Retry
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
