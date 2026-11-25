"use client";

import React, { useState } from "react";
import {
  Skeleton,
  SkeletonChip,
  SkeletonCircle,
  SkeletonText,
  Surface,
  type SkeletonSurfaceVariant,
} from "@/components/ui/skeleton";
import { BoardSkeleton } from "@/components/skeletons/BoardSkeleton";
import { TicketPanelSkeleton } from "@/components/skeletons/TicketPanelSkeleton";
import { SearchPaletteSkeleton } from "@/components/skeletons/SearchPaletteSkeleton";
import { SystemSectionSkeleton } from "@/components/skeletons/SystemConfigSkeleton";

const SURFACE_CASES: Array<{
  variant: SkeletonSurfaceVariant;
  label: string;
  bgClass: string;
}> = [
  { variant: "page", label: "Page (--pw-bg)", bgClass: "bg-[var(--pw-bg)]" },
  { variant: "surface", label: "Surface (--pw-surface)", bgClass: "bg-[var(--pw-surface)]" },
  { variant: "rail", label: "Sidebar Rail (--pw-rail-bg)", bgClass: "bg-[var(--pw-rail-bg)] text-[var(--pw-rail-ink)]" },
  { variant: "card", label: "Card (--pw-bg)", bgClass: "bg-[var(--pw-bg)]" },
  { variant: "panel", label: "Panel (--pw-surface)", bgClass: "bg-[var(--pw-surface)]" },
  { variant: "popover", label: "Popover (--pw-surface)", bgClass: "bg-[var(--pw-surface)]" },
  { variant: "dropdown", label: "Dropdown (--pw-surface)", bgClass: "bg-[var(--pw-surface)]" },
  { variant: "dialog", label: "Dialog (--pw-surface)", bgClass: "bg-[var(--pw-surface)]" },
  { variant: "sheet", label: "Sheet (--pw-surface)", bgClass: "bg-[var(--pw-surface)]" },
  { variant: "table-header", label: "Table Header (--pw-surface-muted)", bgClass: "bg-[var(--pw-surface-muted)]" },
  { variant: "table-row", label: "Table Row (--pw-surface)", bgClass: "bg-[var(--pw-surface)]" },
  { variant: "table-stripe", label: "Table Stripe (--pw-surface-muted)", bgClass: "bg-[var(--pw-surface-muted)]" },
  { variant: "table-hover", label: "Table Hover (--pw-surface-hover)", bgClass: "bg-[var(--pw-surface-hover)]" },
  { variant: "table-selected", label: "Table Selected (--pw-accent-soft)", bgClass: "bg-[var(--pw-accent-soft)]" },
  { variant: "input", label: "Input / Select (--pw-bg)", bgClass: "bg-[var(--pw-bg)]" },
  { variant: "toast", label: "Toast (--pw-surface)", bgClass: "bg-[var(--pw-surface)]" },
  { variant: "tooltip", label: "Tooltip (--pw-surface)", bgClass: "bg-[var(--pw-surface)]" },
  { variant: "command", label: "Command Palette (--pw-surface)", bgClass: "bg-[var(--pw-surface)]" },
  { variant: "code", label: "Code Block (--pw-bg)", bgClass: "bg-[var(--pw-bg)]" },
  { variant: "accent", label: "Accent Tint (--pw-accent-soft)", bgClass: "bg-[var(--pw-accent-soft)]" },
  { variant: "success", label: "Success Tint (--pw-success-soft)", bgClass: "bg-[var(--pw-success-soft)]" },
  { variant: "warning", label: "Warning Tint (--pw-warning-soft)", bgClass: "bg-[var(--pw-warning-soft)]" },
  { variant: "destructive", label: "Destructive Tint (--pw-destructive-soft)", bgClass: "bg-[var(--pw-destructive-soft)]" },
  { variant: "info", label: "Info Tint (--pw-info-soft)", bgClass: "bg-[var(--pw-info-soft)]" },
  { variant: "chip", label: "Status Chip (--pw-surface-muted)", bgClass: "bg-[var(--pw-surface-muted)]" },
];

export function SkeletonGallery() {
  const [dark, setDark] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [forcedOutline, setForcedOutline] = useState(false);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  };

  const toggleReduced = () => {
    const next = !reduced;
    setReduced(next);
    if (next) document.documentElement.dataset.reduceMotion = "true";
    else delete document.documentElement.dataset.reduceMotion;
  };

  return (
    <Surface
      as="main"
      variant="page"
      data-testid="skeleton-gallery"
      className="min-h-screen bg-[var(--pw-bg)] p-6 text-[var(--pw-ink)] space-y-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--pw-border)] pb-4">
        <div>
          <h1 className="text-lg font-semibold">Patchwork Skeleton & Surface Gallery (Dev Only)</h1>
          <p className="text-xs text-[var(--pw-ink-secondary)]">
            Surface-derived OKLCH skeleton contrast matrix and side-by-side compositions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            data-testid="gallery-toggle-theme"
            onClick={toggleDark}
            className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-3 py-1.5 font-medium"
          >
            Theme: {dark ? "Dark" : "Light"}
          </button>
          <button
            type="button"
            data-testid="gallery-toggle-motion"
            onClick={toggleReduced}
            className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-3 py-1.5 font-medium"
          >
            Reduce motion: {reduced ? "On" : "Off"}
          </button>
          <button
            type="button"
            data-testid="gallery-toggle-forced"
            onClick={() => setForcedOutline((v) => !v)}
            className="rounded border border-[var(--pw-border)] bg-[var(--pw-surface)] px-3 py-1.5 font-medium"
          >
            Forced-colors preview: {forcedOutline ? "On" : "Off"}
          </button>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Surface Token Matrix (25 Surfaces)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SURFACE_CASES.map((sc) => (
            <Surface
              key={sc.variant}
              variant={sc.variant}
              data-testid={`gallery-surface-${sc.variant}`}
              className={`rounded-lg border border-[var(--pw-border)] p-4 space-y-3 ${sc.bgClass}`}
              style={forcedOutline ? { outline: "1px solid currentColor" } : undefined}
            >
              <div className="text-xs font-mono font-semibold">{sc.label}</div>
              <div className="flex items-center gap-2.5">
                <SkeletonCircle size={28} />
                <div className="flex-1 space-y-1.5">
                  <Skeleton data-testid={`gallery-sk-${sc.variant}`} className="h-3.5 w-3/4" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
                <SkeletonChip width={48} height={18} />
              </div>
              <SkeletonText lines={2} lineHeightClass="h-2.5" />
            </Surface>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Nested Surfaces (Page → Panel → Card → Chip)</h2>
        <Surface variant="panel" data-testid="gallery-nested-panel" className="rounded-lg border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 space-y-3">
          <Skeleton data-testid="gallery-nested-sk-panel" className="h-3.5 w-40" />
          <Surface variant="card" data-testid="gallery-nested-card" className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3 space-y-2">
            <Skeleton data-testid="gallery-nested-sk-card" className="h-3.5 w-36" />
            <Surface variant="chip" data-testid="gallery-nested-chip" className="inline-flex items-center gap-2 rounded-full bg-[var(--pw-surface-muted)] px-3 py-1">
              <Skeleton data-testid="gallery-nested-sk-chip" className="h-3 w-16" />
            </Surface>
          </Surface>
        </Surface>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Region Compositions</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-lg border border-[var(--pw-border)] overflow-hidden">
            <TicketPanelSkeleton />
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border border-[var(--pw-border)] bg-[var(--pw-surface)]">
              <SearchPaletteSkeleton />
            </div>
            <SystemSectionSkeleton variant="users" />
          </div>
        </div>
        <div className="rounded-lg border border-[var(--pw-border)] overflow-hidden">
          <BoardSkeleton />
        </div>
      </section>
    </Surface>
  );
}
