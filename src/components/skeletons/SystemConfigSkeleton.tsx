"use client";

import React from "react";
import { Skeleton, SkeletonChip, SkeletonCircle, SkeletonText } from "@/components/ui/skeleton";

interface SystemConfigSkeletonProps {
  variant?: "full" | "users" | "hierarchy" | "permissions" | "section";
}

export function SystemSectionSkeleton({
  variant = "section",
}: {
  variant?: "users" | "hierarchy" | "permissions" | "section";
}) {
  if (variant === "users") {
    return (
      <div data-testid="system-users-skeleton" aria-hidden="true" className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-8 w-28" />
        </div>
        <div className="rounded-lg border border-[var(--pw-border)] bg-[var(--pw-surface)] overflow-hidden">
          {[0, 1, 2, 3, 4].map((row) => (
            <div
              key={row}
              className="flex items-center justify-between border-b border-[var(--pw-border)] px-4 py-3 last:border-b-0"
            >
              <div className="flex items-center gap-3">
                <SkeletonCircle size={28} />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-2.5 w-44" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <SkeletonChip width={64} height={20} />
                <Skeleton className="h-6 w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="system-section-skeleton" aria-hidden="true" className="space-y-4">
      <div className="space-y-1.5">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-72" />
      </div>
      <div className="rounded-lg border border-[var(--pw-border)] bg-[var(--pw-surface)] p-4 space-y-3">
        <SkeletonText lines={3} lineHeightClass="h-3" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    </div>
  );
}

export function SystemConfigSkeleton({ variant = "full" }: SystemConfigSkeletonProps) {
  if (variant !== "full") {
    return <SystemSectionSkeleton variant={variant} />;
  }

  return (
    <div
      data-testid="system-config-skeleton"
      aria-label="Loading system configuration"
      aria-busy="true"
      className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--pw-bg)] text-[var(--pw-ink)]"
    >
      <header
        aria-hidden="true"
        className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--pw-border)] bg-[var(--pw-surface)] px-4"
      >
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-7 w-7" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-7 w-24" />
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside
          aria-hidden="true"
          className="hidden md:flex w-60 shrink-0 flex-col gap-1.5 border-r border-[var(--pw-border)] bg-[var(--pw-surface)] p-3"
        >
          {Array.from({ length: 9 }).map((_, idx) => (
            <Skeleton key={idx} className="h-8 w-full" />
          ))}
        </aside>
        <main className="flex-1 overflow-y-auto p-6">
          <SystemSectionSkeleton variant="users" />
        </main>
      </div>
    </div>
  );
}
