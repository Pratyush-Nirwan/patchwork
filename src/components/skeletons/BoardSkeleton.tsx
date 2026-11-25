"use client";

import React from "react";
import { Skeleton, SkeletonChip, SkeletonCircle, SkeletonText, Surface } from "@/components/ui/skeleton";

const CARD_ROWS_PER_COL = [3, 2, 4, 2];

export function BoardSkeleton() {
  return (
    <Surface
      variant="page"
      data-testid="board-skeleton"
      aria-hidden="true"
      className="flex h-full gap-4 overflow-x-auto p-4"
    >
      {CARD_ROWS_PER_COL.map((cardCount, colIdx) => (
        <Surface
          key={colIdx}
          variant="surface"
          className="flex w-72 shrink-0 flex-col rounded-lg border border-[var(--pw-border)] bg-[var(--pw-surface)] p-3"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-4 w-6 rounded-full" />
            </div>
            <Skeleton className="h-5 w-5" />
          </div>

          <div className="space-y-2.5">
            {Array.from({ length: cardCount }).map((_, cardIdx) => (
              <Surface
                key={cardIdx}
                variant="card"
                className="rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] p-2.5 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3 w-14" />
                  <SkeletonChip width={44} height={16} />
                </div>
                <SkeletonText lines={2} lineHeightClass="h-3" widths={["94%", "68%"]} />
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-1.5">
                    <SkeletonChip width={42} height={15} />
                    <SkeletonChip width={36} height={15} />
                  </div>
                  <SkeletonCircle size={20} />
                </div>
              </Surface>
            ))}
          </div>
        </Surface>
      ))}
    </Surface>
  );
}
