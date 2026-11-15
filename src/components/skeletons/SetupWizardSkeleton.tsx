"use client";

import React from "react";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

export function SetupWizardSkeleton() {
  return (
    <div
      data-testid="setup-wizard-skeleton"
      aria-label="Loading setup wizard"
      aria-busy="true"
      className="flex min-h-screen flex-col bg-[var(--pw-bg)] text-[var(--pw-ink)]"
    >
      <header
        aria-hidden="true"
        className="border-b border-[var(--pw-rail-border)] bg-[var(--pw-rail-bg)] px-6 py-3"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-7 bg-[var(--pw-rail-surface)]" />
            <Skeleton className="h-4 w-48 bg-[var(--pw-rail-surface)]" />
          </div>
          <Skeleton className="h-7 w-24 bg-[var(--pw-rail-surface)]" />
        </div>
      </header>

      <div aria-hidden="true" className="mx-auto flex w-full max-w-6xl flex-1 gap-6 p-6">
        <aside className="hidden md:flex w-64 shrink-0 flex-col gap-2">
          {Array.from({ length: 7 }).map((_, idx) => (
            <Skeleton key={idx} className="h-10 w-full" />
          ))}
        </aside>
        <main className="flex-1 rounded-lg border border-[var(--pw-border)] bg-[var(--pw-surface)] p-6 space-y-4">
          <Skeleton className="h-6 w-56" />
          <SkeletonText lines={2} lineHeightClass="h-3" />
          <div className="space-y-3 pt-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        </main>
      </div>
    </div>
  );
}
