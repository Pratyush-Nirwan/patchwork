"use client";

import React from "react";
import { Skeleton, SkeletonChip, Surface } from "@/components/ui/skeleton";

export function SearchPaletteSkeleton() {
  return (
    <Surface
      variant="command"
      data-testid="search-palette-skeleton"
      aria-hidden="true"
      className="space-y-1 p-2"
    >
      {[0, 1, 2, 3, 4].map((row) => (
        <div
          key={row}
          className="flex items-center justify-between rounded-md px-2.5 py-2"
        >
          <div className="flex items-center gap-2.5 flex-1">
            <Skeleton className="h-4 w-4 shrink-0" />
            <Skeleton className="h-3.5 w-16 shrink-0" />
            <Skeleton
              className="h-3.5"
              style={{ width: `${55 + ((row * 13) % 30)}%` }}
            />
          </div>
          <SkeletonChip width={48} height={16} />
        </div>
      ))}
    </Surface>
  );
}
