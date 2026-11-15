"use client";

import React,{ useState,useEffect,useCallback } from "react";
import { XCircle } from "lucide-react";

export function AppearanceSection({
  csrfToken,
  showToast,
}: {
  csrfToken: string;
  showToast: (m: string, t?: "success" | "error") => void;
}) {
  const [defaultTheme, setDefaultTheme] = useState("system");
  const [dateTimeFormat, setDateTimeFormat] = useState("YYYY-MM-DD HH:mm");
  const [priorities, setPriorities] = useState<
    Array<{ id: string; label: string; color: string; rank: number }>
  >([]);
  const [labels, setLabels] = useState<
    Array<{ id: string; name: string; color: string }>
  >([]);
  const [defaultColumns, setDefaultColumns] = useState<
    Array<{ id: string; name: string; position: number }>
  >([]);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#3B82F6");
  const [pending, setPending] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/system/settings/appearance");
      const d = await res.json();
      if (d.settings) {
        setDefaultTheme(d.settings.defaultTheme);
        setDateTimeFormat(d.settings.dateTimeFormat);
        setPriorities(d.settings.priorities || []);
        setLabels(d.settings.labels || []);
        setDefaultColumns(d.settings.defaultColumns || []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    try {
      const res = await fetch("/api/system/settings/appearance", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          defaultTheme,
          dateTimeFormat,
          priorities,
          labels,
          defaultColumns,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      showToast("Appearance & defaults saved successfully");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setPending(false);
    }
  };

  const handleAddLabel = () => {
    if (!newLabelName.trim()) return;
    setLabels((prev) => [
      ...prev,
      {
        id: newLabelName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
        name: newLabelName.trim(),
        color: newLabelColor,
      },
    ]);
    setNewLabelName("");
  };

  const handleRemoveLabel = (name: string) => {
    setLabels((prev) => prev.filter((l) => l.name !== name));
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-[var(--pw-border)] pb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--pw-ink)]">
            Appearance & Workspace Defaults
          </h2>
          <p className="text-xs text-[var(--pw-ink-secondary)]">
            Configure system themes, priority color palettes, global labels, and default kanban columns.
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="max-w-xl space-y-6 text-xs">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block font-medium text-[var(--pw-ink)] mb-1">
              Default Theme
            </label>
            <select
              data-testid="appearance-default-theme"
              value={defaultTheme}
              onChange={(e) => setDefaultTheme(e.target.value)}
              className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-2 text-xs"
            >
              <option value="system">System Preference</option>
              <option value="light">Light Theme</option>
              <option value="dark">Dark Theme</option>
            </select>
          </div>

          <div>
            <label className="block font-medium text-[var(--pw-ink)] mb-1">
              Date & Time Format
            </label>
            <select
              data-testid="appearance-date-format"
              value={dateTimeFormat}
              onChange={(e) => setDateTimeFormat(e.target.value)}
              className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-2 text-xs font-mono"
            >
              <option value="YYYY-MM-DD HH:mm">YYYY-MM-DD HH:mm (ISO-24h)</option>
              <option value="MM/DD/YYYY hh:mm A">MM/DD/YYYY hh:mm A (US-12h)</option>
              <option value="DD/MM/YYYY HH:mm">DD/MM/YYYY HH:mm (EU-24h)</option>
            </select>
          </div>
        </div>

        {/* Priorities palette */}
        <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 space-y-3">
          <h3 className="font-semibold text-xs text-[var(--pw-ink)]">
            Priority Badges & Colors
          </h3>
          <div className="space-y-2">
            {priorities.map((p, idx) => (
              <div key={p.id || idx} className="flex items-center gap-3">
                <input
                  type="color"
                  value={p.color}
                  onChange={(e) => {
                    const next = [...priorities];
                    next[idx].color = e.target.value;
                    setPriorities(next);
                  }}
                  className="h-6 w-8 rounded border border-[var(--pw-border)] p-0 cursor-pointer"
                />
                <span className="font-medium text-[var(--pw-ink)] capitalize w-20">
                  {p.label}
                </span>
                <span className="font-mono text-[11px] text-[var(--pw-ink-tertiary)]">
                  {p.color}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Labels Editor */}
        <div className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 space-y-3">
          <h3 className="font-semibold text-xs text-[var(--pw-ink)]">
            Global Labels
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {labels.map((l) => (
              <span
                key={l.name}
                className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium"
                style={{ backgroundColor: `${l.color}20`, color: l.color }}
              >
                <span>{l.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveLabel(l.name)}
                  className="hover:opacity-75"
                >
                  <XCircle className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-[var(--pw-border)]">
            <input
              type="text"
              placeholder="New label name..."
              value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value)}
              className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-1.5 text-xs flex-1"
            />
            <input
              type="color"
              value={newLabelColor}
              onChange={(e) => setNewLabelColor(e.target.value)}
              className="h-7 w-8 rounded border border-[var(--pw-border)] p-0 cursor-pointer"
            />
            <button
              type="button"
              onClick={handleAddLabel}
              className="rounded bg-[var(--pw-surface-muted)] border border-[var(--pw-border)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--pw-border)]"
            >
              Add Label
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={pending}
          data-testid="save-appearance-btn"
          className="rounded bg-[var(--pw-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save Appearance Defaults"}
        </button>
      </form>
    </div>
  );
}

// ==========================================
// SECTION J: HEALTH & DIAGNOSTICS
// ==========================================
