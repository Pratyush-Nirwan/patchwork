"use client";

import React, { useState, useEffect, useCallback } from "react";
import { SystemSectionSkeleton } from "@/components/skeletons/SystemConfigSkeleton";
import { SkeletonRegion } from "@/components/ui/skeleton";

export function IntegrationsSection({
  csrfToken,
  showToast,
}: {
  csrfToken: string;
  showToast: (m: string, t?: "success" | "error") => void;
}) {
  const [allowedHosts, setAllowedHosts] = useState<string[]>([]);
  const [githubToken, setGithubToken] = useState("");
  const [gitlabToken, setGitlabToken] = useState("");
  const [hasGithubToken, setHasGithubToken] = useState(false);
  const [hasGitlabToken, setHasGitlabToken] = useState(false);
  const [cacheDurationSec, setCacheDurationSec] = useState(300);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/system/settings/integrations");
      const d = await res.json();
      if (d.settings) {
        setAllowedHosts(d.settings.allowedHosts || ["github.com", "gitlab.com"]);
        setCacheDurationSec(d.settings.cacheDurationSec || 300);
        setHasGithubToken(d.settings.hasGithubToken);
        setHasGitlabToken(d.settings.hasGitlabToken);
        if (d.settings.githubTokenMasked) setGithubToken(d.settings.githubTokenMasked);
        if (d.settings.gitlabTokenMasked) setGitlabToken(d.settings.gitlabTokenMasked);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    try {
      const payload: Record<string, unknown> = {
        allowedHosts,
        cacheDurationSec,
      };
      if (githubToken && !githubToken.includes("•")) payload.githubToken = githubToken;
      if (gitlabToken && !gitlabToken.includes("•")) payload.gitlabToken = gitlabToken;

      const res = await fetch("/api/system/settings/integrations", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      showToast("Integration settings saved (tokens encrypted with AES-256-GCM)");
      loadSettings();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setPending(false);
    }
  };

  const handleTestConnection = async (provider: "github" | "gitlab") => {
    setTestingProvider(provider);
    try {
      const token =
        provider === "github"
          ? !githubToken.includes("•") ? githubToken : undefined
          : !gitlabToken.includes("•") ? gitlabToken : undefined;

      const res = await fetch("/api/system/integrations/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ provider, token }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message);
      } else {
        showToast(data.message, "error");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Test failed", "error");
    } finally {
      setTestingProvider(null);
    }
  };

  if (loading) {
    return (
      <SkeletonRegion
        isLoading={loading}
        hasData={false}
        loadingLabel="Loading integration settings"
        readyLabel="Integration settings loaded"
        skeleton={<SystemSectionSkeleton variant="section" />}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-[var(--pw-border)] pb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--pw-ink)]">
            Forge Integrations (GitHub & GitLab)
          </h2>
          <p className="text-xs text-[var(--pw-ink-secondary)]">
            Configure allowed forge hosts and credentials for PR/MR status synchronization.
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="max-w-xl space-y-4 text-xs">
        <div>
          <label className="block font-medium text-[var(--pw-ink)] mb-1">
            Allowed Forge Hosts (comma-separated, supports self-hosted GitLab)
          </label>
          <input
            type="text"
            data-testid="integrations-allowed-hosts"
            value={allowedHosts.join(", ")}
            onChange={(e) =>
              setAllowedHosts(
                e.target.value
                  .split(",")
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean)
              )
            }
            className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-2 text-xs font-mono"
          />
        </div>

        {/* GitHub Token */}
        <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-xs text-[var(--pw-ink)] flex items-center gap-2">
              <span>GitHub Personal Access Token</span>
              {hasGithubToken && (
                <span className="text-[10px] font-normal text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                  Configured
                </span>
              )}
            </span>
            <button
              type="button"
              data-testid="test-github-connection-btn"
              disabled={testingProvider === "github"}
              onClick={() => handleTestConnection("github")}
              className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1 text-[11px] font-medium hover:bg-[var(--pw-surface-muted)]"
            >
              {testingProvider === "github" ? "Testing..." : "Test Connection"}
            </button>
          </div>
          <input
            type="password"
            data-testid="integrations-github-token"
            value={githubToken}
            onChange={(e) => setGithubToken(e.target.value)}
            placeholder="ghp_••••••••••••••••••••••••••••••••••••"
            className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-1.5 text-xs font-mono"
          />
          <div className="text-[11px] text-[var(--pw-ink-tertiary)]">
            Stored write-only, encrypted with AES-256-GCM. Never returned in plaintext.
          </div>
        </div>

        {/* GitLab Token */}
        <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-xs text-[var(--pw-ink)] flex items-center gap-2">
              <span>GitLab Personal Access Token</span>
              {hasGitlabToken && (
                <span className="text-[10px] font-normal text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                  Configured
                </span>
              )}
            </span>
            <button
              type="button"
              data-testid="test-gitlab-connection-btn"
              disabled={testingProvider === "gitlab"}
              onClick={() => handleTestConnection("gitlab")}
              className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-2.5 py-1 text-[11px] font-medium hover:bg-[var(--pw-surface-muted)]"
            >
              {testingProvider === "gitlab" ? "Testing..." : "Test Connection"}
            </button>
          </div>
          <input
            type="password"
            data-testid="integrations-gitlab-token"
            value={gitlabToken}
            onChange={(e) => setGitlabToken(e.target.value)}
            placeholder="glpat-••••••••••••••••••••"
            className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-1.5 text-xs font-mono"
          />
        </div>

        <div>
          <label className="block font-medium text-[var(--pw-ink)] mb-1">
            Status Cache TTL (seconds)
          </label>
          <input
            type="number"
            min={10}
            max={86400}
            data-testid="integrations-cache-ttl"
            value={cacheDurationSec}
            onChange={(e) => setCacheDurationSec(parseInt(e.target.value, 10))}
            className="w-28 rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-2 text-xs font-mono"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          data-testid="save-integrations-btn"
          className="rounded bg-[var(--pw-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save Integrations"}
        </button>
      </form>
    </div>
  );
}

// ==========================================
// SECTION I: APPEARANCE & DEFAULTS
// ==========================================
