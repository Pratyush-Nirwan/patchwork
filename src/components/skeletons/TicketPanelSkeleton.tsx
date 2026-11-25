"use client";

import React from "react";
import { Skeleton, SkeletonChip, SkeletonCircle, SkeletonText, Surface } from "@/components/ui/skeleton";

export function TicketPanelSkeleton() {
  return (
    <Surface
      variant="panel"
      data-testid="ticket-panel-skeleton"
      aria-hidden="true"
      className="flex h-full flex-col bg-[var(--pw-surface)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--pw-border)] px-4 py-3">
        <Skeleton className="h-5 w-16" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-6 w-6" />
        </div>
      </div>

      <div className="space-y-6 p-4">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-6 w-12" />
          </div>
          <div className="flex flex-wrap gap-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-6 w-36" />
          </div>
          <div className="flex flex-wrap gap-3">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-6 w-28" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <SkeletonChip width={48} height={18} />
            <SkeletonChip width={56} height={18} />
            <SkeletonChip width={64} height={18} />
          </div>
          <Surface variant="card" className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3">
            <SkeletonText lines={4} lineHeightClass="h-3" />
          </Surface>
        </div>

        <div className="border-t border-[var(--pw-border)] pt-4 space-y-3">
          <Skeleton className="h-3.5 w-24" />
          {[0, 1].map((idx) => (
            <Surface
              key={idx}
              variant="card"
              className="flex items-start gap-2.5 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3"
            >
              <SkeletonCircle size={24} />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-32" />
                <SkeletonText lines={2} lineHeightClass="h-2.5" />
              </div>
            </Surface>
          ))}
        </div>
      </div>
    </Surface>
  );
}
