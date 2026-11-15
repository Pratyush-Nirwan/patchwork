"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import {
  MOTION_DISTANCES,
  MOTION_DURATIONS,
  MOTION_EASINGS,
  useReducedMotion,
} from "@/lib/motion";

export type MotionDurationKey = keyof typeof MOTION_DURATIONS;
export type MotionDistanceKey = keyof typeof MOTION_DISTANCES;

function resolveDuration(duration: MotionDurationKey | number, reduced: boolean): number {
  if (reduced) return 0;
  return typeof duration === "number" ? duration : MOTION_DURATIONS[duration];
}

function resolveDistance(distance: MotionDistanceKey | number | string): string {
  if (typeof distance === "number") return `${distance}px`;
  if (distance in MOTION_DISTANCES) {
    return `${MOTION_DISTANCES[distance as MotionDistanceKey]}px`;
  }
  return distance;
}

interface PresenceProps {
  show: boolean;
  duration?: MotionDurationKey | number;
  unmountOnExit?: boolean;
  children: (state: "entering" | "entered" | "exiting") => React.ReactNode;
}

export function Presence({
  show,
  duration = "base",
  unmountOnExit = true,
  children,
}: PresenceProps) {
  const reduced = useReducedMotion();
  const durMs = resolveDuration(duration, reduced);
  const [mounted, setMounted] = useState(show);
  const [phase, setPhase] = useState<"entering" | "entered" | "exiting">(
    show ? "entered" : "exiting"
  );

  useEffect(() => {
    if (show) {
      setMounted(true);
      if (durMs === 0) {
        setPhase("entered");
        return;
      }
      setPhase("entering");
      const raf = requestAnimationFrame(() => {
        setPhase("entered");
      });
      return () => cancelAnimationFrame(raf);
    }

    setPhase("exiting");
    if (!unmountOnExit) return;
    if (durMs === 0) {
      setMounted(false);
      return;
    }
    const timer = setTimeout(() => setMounted(false), durMs);
    return () => clearTimeout(timer);
  }, [show, durMs, unmountOnExit]);

  if (!mounted && unmountOnExit) return null;
  return <>{children(phase)}</>;
}

interface FadeProps {
  show?: boolean;
  duration?: MotionDurationKey | number;
  delayMs?: number;
  className?: string;
  children: React.ReactNode;
}

export function Fade({
  show = true,
  duration = "fast",
  delayMs = 0,
  className = "",
  children,
}: FadeProps) {
  const reduced = useReducedMotion();
  const durMs = resolveDuration(duration, reduced);
  const [visible, setVisible] = useState(reduced ? show : false);

  useEffect(() => {
    if (reduced) {
      setVisible(show);
      return;
    }
    if (show) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
  }, [show, reduced]);

  return (
    <div
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transitionProperty: "opacity",
        transitionDuration: `${durMs}ms`,
        transitionTimingFunction: MOTION_EASINGS.out,
        transitionDelay: reduced ? "0ms" : `${delayMs}ms`,
      }}
    >
      {children}
    </div>
  );
}

interface SlideProps {
  show?: boolean;
  direction?: "up" | "down" | "left" | "right";
  distance?: MotionDistanceKey | number | string;
  duration?: MotionDurationKey | number;
  delayMs?: number;
  className?: string;
  children: React.ReactNode;
}

export function Slide({
  show = true,
  direction = "up",
  distance = "sm",
  duration = "base",
  delayMs = 0,
  className = "",
  children,
}: SlideProps) {
  const reduced = useReducedMotion();
  const durMs = resolveDuration(duration, reduced);
  const [visible, setVisible] = useState(reduced ? show : false);

  useEffect(() => {
    if (reduced) {
      setVisible(show);
      return;
    }
    if (show) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
  }, [show, reduced]);

  const dist = resolveDistance(distance);
  let hiddenTransform = "translate3d(0, 0, 0)";
  if (!reduced) {
    if (direction === "up") hiddenTransform = `translate3d(0, ${dist}, 0)`;
    else if (direction === "down") hiddenTransform = `translate3d(0, -${dist}, 0)`;
    else if (direction === "left") hiddenTransform = `translate3d(${dist}, 0, 0)`;
    else if (direction === "right") hiddenTransform = `translate3d(-${dist}, 0, 0)`;
  }

  return (
    <div
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translate3d(0, 0, 0)" : hiddenTransform,
        transitionProperty: reduced ? "opacity" : "transform, opacity",
        transitionDuration: `${durMs}ms`,
        transitionTimingFunction: visible ? MOTION_EASINGS.out : MOTION_EASINGS.in,
        transitionDelay: reduced ? "0ms" : `${delayMs}ms`,
      }}
    >
      {children}
    </div>
  );
}

interface ScaleProps {
  show?: boolean;
  from?: number;
  duration?: MotionDurationKey | number;
  className?: string;
  children: React.ReactNode;
}

export function Scale({
  show = true,
  from = 0.97,
  duration = "base",
  className = "",
  children,
}: ScaleProps) {
  const reduced = useReducedMotion();
  const durMs = resolveDuration(duration, reduced);
  const [visible, setVisible] = useState(reduced ? show : false);

  useEffect(() => {
    if (reduced) {
      setVisible(show);
      return;
    }
    if (show) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
  }, [show, reduced]);

  return (
    <div
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: reduced ? "none" : visible ? "scale(1)" : `scale(${from})`,
        transitionProperty: reduced ? "opacity" : "transform, opacity",
        transitionDuration: `${durMs}ms`,
        transitionTimingFunction: visible ? MOTION_EASINGS.out : MOTION_EASINGS.in,
      }}
    >
      {children}
    </div>
  );
}

interface CollapseProps {
  open: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function Collapse({ open, className = "", children }: CollapseProps) {
  return (
    <div className={`pw-collapse ${className}`} data-open={open ? "true" : "false"}>
      <div className="pw-collapse-inner">{children}</div>
    </div>
  );
}

interface RouteProgressBarProps {
  active: boolean;
  className?: string;
  label?: string;
}

export function RouteProgressBar({
  active,
  className = "",
  label = "Updating...",
}: RouteProgressBarProps) {
  if (!active) return null;
  return (
    <div
      className={`pw-progress-bar-track ${className}`}
      role="progressbar"
      aria-label={label}
      aria-busy="true"
    >
      <div className="pw-progress-bar-fill" />
    </div>
  );
}

interface RegionErrorBoundaryProps {
  regionName?: string;
  onRetry?: () => void;
  children: React.ReactNode;
}

interface RegionErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class RegionErrorBoundary extends React.Component<
  RegionErrorBoundaryProps,
  RegionErrorBoundaryState
> {
  constructor(props: RegionErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): RegionErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || "An unexpected rendering error occurred.",
    };
  }

  handleReset = () => {
    this.setState({ hasError: false, message: "" });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          data-testid="region-error-boundary"
          className="m-4 rounded-lg border border-[var(--pw-border)] bg-[var(--pw-surface)] p-5 text-[var(--pw-ink)] shadow-[var(--pw-shadow)]"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--pw-urgent)]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {this.props.regionName
                ? `Failed to render ${this.props.regionName}`
                : "Something went wrong in this section"}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-[var(--pw-ink-secondary)]">
            {this.state.message}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            className="mt-3 inline-flex items-center gap-1.5 rounded border border-[var(--pw-border)] bg-[var(--pw-bg)] px-3 py-1.5 text-xs font-medium text-[var(--pw-ink)] hover:bg-[var(--pw-surface-hover)] transition"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Retry</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
