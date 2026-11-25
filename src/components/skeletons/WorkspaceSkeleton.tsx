"use client";

import React from "react";
import { Skeleton, SkeletonCircle, Surface } from "@/components/ui/skeleton";
import { BoardSkeleton } from "@/components/skeletons/BoardSkeleton";

export function WorkspaceSkeleton() {
  return (
    <Surface
      variant="page"
      data-testid="workspace-skeleton"
      aria-label="Loading workspace"
      aria-busy="true"
      className="flex h-screen w-screen overflow-hidden bg-[var(--pw-bg)] text-[var(--pw-ink)]"
    >
      {/* Left Navigation Rail (desktop) */}
      <Surface
        as="aside"
        variant="rail"
        aria-hidden="true"
        className="hidden md:flex w-60 shrink-0 flex-col border-r border-[var(--pw-rail-border)] bg-[var(--pw-rail-bg)] p-3"
      >
        <div className="mb-4 flex items-center gap-2.5 px-1">
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-3.5 w-28" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-6 w-4/5" />
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-6 w-5/6" />
        </div>
        <div className="mt-6 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-4/5" />
        </div>
        <div className="mt-auto flex items-center gap-2.5 border-t border-[var(--pw-rail-border)] pt-3">
          <SkeletonCircle size={28} />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        </div>
      </Surface>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Surface
          as="header"
          variant="surface"
          aria-hidden="true"
          className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--pw-border)] bg-[var(--pw-surface)] px-4"
        >
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-7" />
            <Skeleton className="h-7 w-56 sm:w-72" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-7 w-20" />
          </div>
        </Surface>

        <div className="flex-1 overflow-hidden">
          <BoardSkeleton />
        </div>
      </div>
    </Surface>
  );
}
