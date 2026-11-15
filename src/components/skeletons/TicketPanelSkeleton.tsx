"use client";

import React from "react";
import { Skeleton, SkeletonChip, SkeletonCircle, SkeletonText } from "@/components/ui/skeleton";

export function TicketPanelSkeleton() {
  return (
    <div
      data-testid="ticket-panel-skeleton"
      aria-hidden="true"
      className="flex h-full flex-col"
    >
      <div className="flex items-center justify-between border-b border-[var(--pw-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-20" />
        </div>
        <Skeleton className="h-6 w-6" />
      </div>

      <div className="space-y-6 p-4">
        <div className="space-y-3">
          <Skeleton className="h-5 w-4/5" />
          <div className="flex flex-wrap gap-2">
            <SkeletonChip width={64} height={20} />
            <SkeletonChip width={56} height={20} />
            <SkeletonChip width={72} height={20} />
          </div>
          <SkeletonText lines={4} lineHeightClass="h-3" />
        </div>

        <div className="border-t border-[var(--pw-border)] pt-4 space-y-3">
          <Skeleton className="h-3.5 w-24" />
          {[0, 1].map((idx) => (
            <div
              key={idx}
              className="flex items-start gap-2.5 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-3"
            >
              <SkeletonCircle size={24} />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-32" />
                <SkeletonText lines={2} lineHeightClass="h-2.5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
