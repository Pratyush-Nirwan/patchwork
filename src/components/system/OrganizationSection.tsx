"use client";

import React,{ useState,useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { SystemSectionSkeleton } from "@/components/skeletons/SystemConfigSkeleton";

export function OrganizationSection({
  orgId,
  csrfToken,
  showToast,
}: {
  orgId: string;
  csrfToken: string;
  showToast: (m: string, t?: "success" | "error") => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [initialSlug, setInitialSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    fetch("/api/system/organization", { headers: { "x-org-id": orgId } })
      .then((r) => r.json())
      .then((d) => {
        if (d.org) {
          setName(d.org.name);
          setSlug(d.org.slug);
          setInitialSlug(d.org.slug);
          setDescription(d.org.description || "");
        }
      })
      .finally(() => setLoading(false));
  }, [orgId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    try {
      const res = await fetch("/api/system/organization", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
          "x-org-id": orgId,
        },
        body: JSON.stringify({ name, slug, description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      setInitialSlug(data.org.slug);
      showToast(
        data.slugChanged
          ? "Organization updated! Workspace URLs have changed."
          : "Organization details saved successfully"
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setPending(false);
    }
  };

  if (loading) return <SystemSectionSkeleton variant="section" />;

  return (
    <div className="space-y-4">
      <div className="border-b border-[var(--pw-border)] pb-4">
        <h2 className="text-base font-semibold text-[var(--pw-ink)]">
          Organization Profile
        </h2>
        <p className="text-xs text-[var(--pw-ink-secondary)]">
          Configure organization identity and routing slug.
        </p>
      </div>

      <form onSubmit={handleSave} className="max-w-xl space-y-4 text-xs">
        <div>
          <label className="block font-medium text-[var(--pw-ink)] mb-1">
            Organization Name
          </label>
          <input
            type="text"
            required
            data-testid="org-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-2 text-xs text-[var(--pw-ink)]"
          />
        </div>

        <div>
          <label className="block font-medium text-[var(--pw-ink)] mb-1">
            Organization Slug
          </label>
          <input
            type="text"
            required
            data-testid="org-slug-input"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-2 text-xs text-[var(--pw-ink)] font-mono"
          />
          {slug !== initialSlug && (
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Warning: Changing the slug changes all workspace URLs and board links.</span>
            </div>
          )}
        </div>

        <div>
          <label className="block font-medium text-[var(--pw-ink)] mb-1">
            Description
          </label>
          <textarea
            rows={3}
            data-testid="org-desc-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Engineering organization workspace..."
            className="w-full rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] p-2 text-xs text-[var(--pw-ink)]"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          data-testid="save-org-btn"
          className="rounded bg-[var(--pw-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--pw-accent-hover)] disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save Organization"}
        </button>
      </form>
    </div>
  );
}

// ==========================================
// SECTION C: TEAMS, PROJECTS, BOARDS
// ==========================================
