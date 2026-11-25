"use client";

import React from "react";
import { useAntiFlashLoading, useReducedMotion, MOTION_DURATIONS, MOTION_EASINGS } from "@/lib/motion";
import { RouteProgressBar } from "@/components/ui/motion";

export type SkeletonSurfaceVariant =
  | "page"
  | "surface"
  | "rail"
  | "card"
  | "panel"
  | "popover"
  | "dropdown"
  | "dialog"
  | "sheet"
  | "table-header"
  | "table-row"
  | "table-stripe"
  | "table-hover"
  | "table-selected"
  | "input"
  | "toast"
  | "tooltip"
  | "command"
  | "code"
  | "accent"
  | "success"
  | "warning"
  | "destructive"
  | "info"
  | "chip";

interface SurfaceProps extends React.HTMLAttributes<HTMLElement> {
  variant?: SkeletonSurfaceVariant;
  as?: "div" | "section" | "aside" | "header" | "main" | "nav" | "tr" | "li" | "article";
  children?: React.ReactNode;
}

export function Surface({
  variant = "surface",
  as: Tag = "div",
  className = "",
  children,
  ...rest
}: SurfaceProps) {
  return (
    <Tag data-sk-surface={variant} className={className} {...rest}>
      {children}
    </Tag>
  );
}

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ className = "", style, ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`pw-skeleton rounded ${className}`}
      style={style}
      {...rest}
    />
  );
}

interface SkeletonTextProps {
  lines?: number;
  className?: string;
  lineHeightClass?: string;
  widths?: string[];
}

const DEFAULT_LINE_WIDTHS = ["100%", "92%", "78%", "86%", "64%"];

export function SkeletonText({
  lines = 2,
  className = "",
  lineHeightClass = "h-3",
  widths = DEFAULT_LINE_WIDTHS,
}: SkeletonTextProps) {
  return (
    <div aria-hidden="true" className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, idx) => (
        <Skeleton
          key={idx}
          className={lineHeightClass}
          style={{ width: widths[idx % widths.length] }}
        />
      ))}
    </div>
  );
}

interface SkeletonCircleProps {
  size?: number;
  className?: string;
}

export function SkeletonCircle({ size = 24, className = "" }: SkeletonCircleProps) {
  return (
    <Skeleton
      className={`rounded-full shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

interface SkeletonChipProps {
  width?: number | string;
  height?: number | string;
  className?: string;
}

export function SkeletonChip({
  width = 56,
  height = 18,
  className = "",
}: SkeletonChipProps) {
  return (
    <Skeleton
      className={`rounded-full shrink-0 ${className}`}
      style={{ width, height }}
    />
  );
}

interface SkeletonRegionProps {
  isLoading: boolean;
  hasData: boolean;
  skeleton: React.ReactNode;
  children?: React.ReactNode;
  loadingLabel?: string;
  readyLabel?: string;
  delayMs?: number;
  minHoldMs?: number;
  isRevalidating?: boolean;
  className?: string;
  testId?: string;
}

export function SkeletonRegion({
  isLoading,
  hasData,
  skeleton,
  children,
  loadingLabel = "Loading content",
  readyLabel = "Content loaded",
  delayMs = 150,
  minHoldMs = 300,
  isRevalidating = false,
  className = "",
  testId,
}: SkeletonRegionProps) {
  const reduced = useReducedMotion();
  const showSkeleton = useAntiFlashLoading(isLoading && !hasData, delayMs, minHoldMs);
  const revalidating = hasData && (isLoading || isRevalidating);
  const fadeMs = reduced ? 0 : MOTION_DURATIONS.fast;

  return (
    <div
      data-testid={testId}
      aria-busy={isLoading || isRevalidating}
      className={`relative ${className}`}
    >
      <span className="sr-only" aria-live="polite">
        {showSkeleton ? loadingLabel : hasData ? readyLabel : ""}
      </span>

      {revalidating && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
          <RouteProgressBar active label={loadingLabel} />
        </div>
      )}

      {showSkeleton ? (
        <div
          key="skeleton"
          style={{
            transitionProperty: "opacity",
            transitionDuration: `${fadeMs}ms`,
            transitionTimingFunction: MOTION_EASINGS.out,
          }}
        >
          {skeleton}
        </div>
      ) : hasData ? (
        <div
          key="content"
          className={revalidating ? "opacity-60" : "opacity-100"}
          style={{
            transitionProperty: "opacity",
            transitionDuration: `${fadeMs}ms`,
            transitionTimingFunction: MOTION_EASINGS.out,
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

interface RevalidateBarProps {
  active: boolean;
  label?: string;
  className?: string;
}

export function RevalidateBar({
  active,
  label = "Refreshing data...",
  className = "",
}: RevalidateBarProps) {
  if (!active) return null;
  return (
    <div className={`pointer-events-none absolute inset-x-0 top-0 z-30 ${className}`}>
      <RouteProgressBar active label={label} />
    </div>
  );
}
