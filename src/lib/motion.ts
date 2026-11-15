"use client";

import { useEffect, useRef, useState } from "react";

export const MOTION_DURATIONS = {
  instant: 0,
  fast: 120,
  base: 180,
  slow: 260,
  page: 320,
} as const;

export const MOTION_EASINGS = {
  out: "cubic-bezier(0.16, 1, 0.3, 1)",
  in: "cubic-bezier(0.7, 0, 0.84, 0)",
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
} as const;

export const MOTION_DISTANCES = {
  xs: 4,
  sm: 8,
  md: 16,
} as const;

export const MOTION_STAGGER = {
  stepMs: 24,
  maxItems: 12,
} as const;

export const REDUCE_MOTION_STORAGE_KEY = "patchwork_reduce_motion";
export const REDUCE_MOTION_EVENT = "patchwork:reduce-motion-change";

export function getReduceMotionPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(REDUCE_MOTION_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setReduceMotionPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) {
      window.localStorage.setItem(REDUCE_MOTION_STORAGE_KEY, "true");
      document.documentElement.dataset.reduceMotion = "true";
    } else {
      window.localStorage.removeItem(REDUCE_MOTION_STORAGE_KEY);
      delete document.documentElement.dataset.reduceMotion;
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
  window.dispatchEvent(new CustomEvent(REDUCE_MOTION_EVENT, { detail: enabled }));
}

export function isTestAnimationsDisabled(): boolean {
  if (process.env.NEXT_PUBLIC_DISABLE_ANIMATIONS === "1") return true;
  if (typeof window === "undefined") return false;
  const win = window as unknown as { __PATCHWORK_TEST_DISABLE_ANIMATIONS__?: boolean };
  return (
    Boolean(win.__PATCHWORK_TEST_DISABLE_ANIMATIONS__) ||
    document.documentElement.dataset.testAnimations === "off"
  );
}

export function getEffectiveReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (isTestAnimationsDisabled()) return true;
  if (getReduceMotionPreference()) return true;
  if (document.documentElement.dataset.reduceMotion === "true") return true;
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  return false;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => getEffectiveReducedMotion());

  useEffect(() => {
    const sync = () => setReduced(getEffectiveReducedMotion());
    sync();

    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;

    mq?.addEventListener?.("change", sync);
    window.addEventListener(REDUCE_MOTION_EVENT, sync);
    window.addEventListener("storage", sync);

    return () => {
      mq?.removeEventListener?.("change", sync);
      window.removeEventListener(REDUCE_MOTION_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return reduced;
}

export function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState<boolean>(() =>
    typeof document !== "undefined" ? document.hidden : false
  );

  useEffect(() => {
    const onVisibilityChange = () => {
      const isHidden = document.hidden;
      setHidden(isHidden);
      document.documentElement.classList.toggle("pw-tab-hidden", isHidden);
    };
    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return hidden;
}

/**
 * Anti-flash skeleton timing:
 * - Only show skeleton if loading takes longer than `delayMs` (default 150ms).
 * - Once shown, keep visible for at least `minHoldMs` (default 300ms).
 */
export function useAntiFlashLoading(
  isLoading: boolean,
  delayMs = 150,
  minHoldMs = 300
): boolean {
  const [showSkeleton, setShowSkeleton] = useState(false);
  const shownAtRef = useRef<number | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (isLoading) {
      if (showSkeleton) return;
      if (delayMs <= 0) {
        shownAtRef.current = Date.now();
        setShowSkeleton(true);
        return;
      }
      showTimerRef.current = setTimeout(() => {
        shownAtRef.current = Date.now();
        setShowSkeleton(true);
      }, delayMs);
    } else if (showSkeleton) {
      const elapsed = shownAtRef.current ? Date.now() - shownAtRef.current : minHoldMs;
      const remaining = Math.max(0, minHoldMs - elapsed);
      if (remaining === 0) {
        shownAtRef.current = null;
        setShowSkeleton(false);
      } else {
        hideTimerRef.current = setTimeout(() => {
          shownAtRef.current = null;
          setShowSkeleton(false);
        }, remaining);
      }
    }

    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [isLoading, showSkeleton, delayMs, minHoldMs]);

  return showSkeleton;
}

export function getStaggerDelayMs(index: number, reducedMotion: boolean): number {
  if (reducedMotion || index <= 0) return 0;
  return Math.min(index, MOTION_STAGGER.maxItems) * MOTION_STAGGER.stepMs;
}
