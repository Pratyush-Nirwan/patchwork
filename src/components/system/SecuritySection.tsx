"use client";

import React,{ useState,useEffect,useCallback } from "react";
import { SystemSectionSkeleton } from "@/components/skeletons/SystemConfigSkeleton";
import { HoldToConfirmButton } from "./HoldToConfirmButton";

export function SecuritySection({
  csrfToken,
  showToast,
}: {
  csrfToken: string;
  showToast: (m: string, t?: "success" | "error") => void;
}) {
  const [passwordMinLength, setPasswordMinLength] = useState(8);
  const [passwordRequireMixedCase, setPasswordRequireMixedCase] = useState(false);
  const [passwordRequireDigit, setPasswordRequireDigit] = useState(false);
  const [passwordRequireSymbol, setPasswordRequireSymbol] = useState(false);
  const [sessionLifetimeDays, setSessionLifetimeDays] = useState(7);
  const [sessionIdleTimeoutMins, setSessionIdleTimeoutMins] = useState(0);
  const [rateLimitMaxFailures, setRateLimitMaxFailures] = useState(5);
  const [rateLimitWindowMins, setRateLimitWindowMins] = useState(15);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/system/settings/security");
      const d = await res.json();
      if (d.settings) {
        setPasswordMinLength(d.settings.passwordMinLength);
        setPasswordRequireMixedCase(d.settings.passwordRequireMixedCase);
        setPasswordRequireDigit(d.settings.passwordRequireDigit);
        setPasswordRequireSymbol(d.settings.passwordRequireSymbol);
        setSessionLifetimeDays(Math.round(d.settings.sessionLifetimeMs / (24 * 3600 * 1000)));
        setSessionIdleTimeoutMins(Math.round(d.settings.sessionIdleTimeoutMs / 60000));
        setRateLimitMaxFailures(d.settings.rateLimitMaxFailures);
        setRateLimitWindowMins(Math.round(d.settings.rateLimitWindowMs / 60000));
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
      const payload = {
        passwordMinLength,
        passwordRequireMixedCase,
        passwordRequireDigit,
        passwordRequireSymbol,
        sessionLifetimeMs: sessionLifetimeDays * 24 * 3600 * 1000,
        sessionIdleTimeoutMs: sessionIdleTimeoutMins * 60000,
        rateLimitMaxFailures,
        rateLimitWindowMs: rateLimitWindowMins * 60000,
      };
      const res = await fetch("/api/system/settings/security", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      showToast("Security settings saved and active without restart");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setPending(false);
    }
  };

  const handleReset = async () => {
    try {
      const res = await fetch("/api/system/settings/security", {
        method: "DELETE",
        headers: { "x-csrf-token": csrfToken },
      });
      if (!res.ok) throw new Error("Reset failed");
      showToast("Security settings reset to default");
      loadSettings();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Reset failed", "error");
    }
  };

  const handleSignOutAll = async () => {
    if (!confirm("Are you sure you want to sign out all users across the workspace?")) return;
    try {
      const res = await fetch("/api/system/settings/security", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ action: "sign-out-all" }),
      });
      if (!res.ok) throw new Error("Sign-out failed");
      showToast("All user sessions revoked successfully");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Sign-out failed", "error");
    }
  };

  if (loading) return <SystemSectionSkeleton variant="section" />;

  return (
    <div className="space-y-6">
      <div className="border-b border-[var(--pw-border)] pb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--pw-ink)]">
            Security & Authentication Policy
          </h2>
          <p className="text-xs text-[var(--pw-ink-secondary)]">
            Manage password complexity, session duration, and rate limiting thresholds.
          </p>
        </div>
        <button
          type="button"
          data-testid="reset-security-defaults"
          onClick={handleReset}
          className="text-xs text-[var(--pw-ink-secondary)] hover:text-[var(--pw-ink)] underline"
        >
          Reset to default
        </button>
      </div>

      <form onSubmit={handleSave} className="max-w-xl space-y-6 text-xs">
        {/* Password Policy */}
        <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 space-y-3">
          <h3 className="font-semibold text-xs text-[var(--pw-ink)]">
            Password Policy
          </h3>

          <div>
            <label className="block text-[var(--pw-ink-secondary)] mb-1">
              Minimum Password Length (characters)
            </label>
            <input
              type="number"
              min={6}
              max={128}
              data-testid="security-password-min-length"
              value={passwordMinLength}
              onChange={(e) => setPasswordMinLength(parseInt(e.target.value, 10))}
              className="w-24 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-1.5 text-xs"
            />
          </div>

          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                data-testid="security-require-mixed-case"
                checked={passwordRequireMixedCase}
                onChange={(e) => setPasswordRequireMixedCase(e.target.checked)}
                className="rounded border-[var(--pw-border)]"
              />
              <span>Require mixed case (uppercase & lowercase letters)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                data-testid="security-require-digit"
                checked={passwordRequireDigit}
                onChange={(e) => setPasswordRequireDigit(e.target.checked)}
                className="rounded border-[var(--pw-border)]"
              />
              <span>Require at least one digit (0-9)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                data-testid="security-require-symbol"
                checked={passwordRequireSymbol}
                onChange={(e) => setPasswordRequireSymbol(e.target.checked)}
                className="rounded border-[var(--pw-border)]"
              />
              <span>Require at least one symbol / special character</span>
            </label>
          </div>
        </div>

        {/* Sessions */}
        <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-xs text-[var(--pw-ink)]">
              Session Management
            </h3>
            <HoldToConfirmButton
              data-testid="sign-out-all-users-btn"
              variant="danger"
              onConfirm={handleSignOutAll}
              className="rounded px-2.5 py-1 text-xs font-semibold"
              holdLabel="Holding to sign out..."
            >
              Hold to Sign out all users
            </HoldToConfirmButton>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[var(--pw-ink-secondary)] mb-1">
                Session Lifetime (days)
              </label>
              <input
                type="number"
                min={1}
                max={365}
                data-testid="security-session-lifetime"
                value={sessionLifetimeDays}
                onChange={(e) => setSessionLifetimeDays(parseInt(e.target.value, 10))}
                className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-[var(--pw-ink-secondary)] mb-1">
                Idle Timeout (mins, 0 = disabled)
              </label>
              <input
                type="number"
                min={0}
                max={43200}
                data-testid="security-session-idle-timeout"
                value={sessionIdleTimeoutMins}
                onChange={(e) => setSessionIdleTimeoutMins(parseInt(e.target.value, 10))}
                className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-1.5 text-xs"
              />
              <p className="mt-1 text-[11px] text-[var(--pw-ink-tertiary)]">
                0 = disabled; otherwise 1–43,200 minutes (up to 30 days). Separate from total session lifetime.
              </p>
            </div>
          </div>
        </div>

        {/* Rate Limiting */}
        <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 space-y-3">
          <h3 className="font-semibold text-xs text-[var(--pw-ink)]">
            Login Protection & Rate Limiting
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[var(--pw-ink-secondary)] mb-1">
                Max Failed Attempts
              </label>
              <input
                type="number"
                min={1}
                max={50}
                data-testid="security-rate-limit-failures"
                value={rateLimitMaxFailures}
                onChange={(e) => setRateLimitMaxFailures(parseInt(e.target.value, 10))}
                className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-[var(--pw-ink-secondary)] mb-1">
                Lockout Window (minutes)
              </label>
              <input
                type="number"
                min={1}
                max={1440}
                data-testid="security-rate-limit-window"
                value={rateLimitWindowMins}
                onChange={(e) => setRateLimitWindowMins(parseInt(e.target.value, 10))}
                className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-1.5 text-xs"
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={pending}
          data-testid="save-security-btn"
          className="rounded bg-[var(--pw-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save Security Policy"}
        </button>
      </form>
    </div>
  );
}

// ==========================================
// SECTION F: ATTACHMENTS & STORAGE
// ==========================================
