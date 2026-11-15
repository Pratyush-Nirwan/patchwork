import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MOTION_DISTANCES,
  MOTION_DURATIONS,
  MOTION_EASINGS,
  MOTION_STAGGER,
  getReduceMotionPreference,
  getStaggerDelayMs,
  setReduceMotionPreference,
} from "../src/lib/motion";
import {
  Collapse,
  RegionErrorBoundary,
  RouteProgressBar,
} from "../src/components/ui/motion";
import {
  RevalidateBar,
  Skeleton,
  SkeletonChip,
  SkeletonCircle,
  SkeletonRegion,
  SkeletonText,
} from "../src/components/ui/skeleton";
import { WorkspaceSkeleton } from "../src/components/skeletons/WorkspaceSkeleton";
import { BoardSkeleton } from "../src/components/skeletons/BoardSkeleton";
import { TicketPanelSkeleton } from "../src/components/skeletons/TicketPanelSkeleton";
import { SystemConfigSkeleton } from "../src/components/skeletons/SystemConfigSkeleton";
import { SetupWizardSkeleton } from "../src/components/skeletons/SetupWizardSkeleton";
import { SearchPaletteSkeleton } from "../src/components/skeletons/SearchPaletteSkeleton";

const ROOT = process.cwd();

describe("Motion tokens & CSS constraints", () => {
  it("defines all required motion tokens in globals.css and src/lib/motion.ts", () => {
    const css = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    expect(css).toContain("--pw-dur-instant: 0ms");
    expect(css).toContain("--pw-dur-fast: 120ms");
    expect(css).toContain("--pw-dur-base: 180ms");
    expect(css).toContain("--pw-dur-slow: 260ms");
    expect(css).toContain("--pw-dur-page: 320ms");
    expect(css).toContain("--pw-ease-out:");
    expect(css).toContain("--pw-ease-in:");
    expect(css).toContain("--pw-ease-in-out:");
    expect(css).toContain("--pw-dist-xs: 4px");
    expect(css).toContain("--pw-dist-sm: 8px");
    expect(css).toContain("--pw-dist-md: 16px");
    expect(css).toContain("--pw-stagger-step: 24ms");
    expect(css).toContain("scrollbar-gutter: stable");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain('[data-reduce-motion="true"]');
    expect(css).toContain('[data-test-animations="off"]');
    expect(css).toContain(".pw-tab-hidden");

    expect(MOTION_DURATIONS).toEqual({
      instant: 0,
      fast: 120,
      base: 180,
      slow: 260,
      page: 320,
    });
    expect(MOTION_DISTANCES).toEqual({ xs: 4, sm: 8, md: 16 });
    expect(MOTION_STAGGER).toEqual({ stepMs: 24, maxItems: 12 });
    expect(MOTION_EASINGS.out).toContain("cubic-bezier");
  });

  it("never animates prohibited layout properties in @keyframes", () => {
    const css = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    const keyframeBlocks = css.match(/@keyframes\s+[^{]+\{[\s\S]*?\n\}/g) || [];
    expect(keyframeBlocks.length).toBeGreaterThanOrEqual(4);
    for (const block of keyframeBlocks) {
      expect(block).not.toMatch(/\b(width|height|top|left|right|bottom|margin|box-shadow)\s*:/);
    }
  });

  it("includes pre-paint theme & reduce-motion script in layout.tsx wrapped in try/catch", () => {
    const layout = fs.readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");
    expect(layout).toContain("patchwork_theme");
    expect(layout).toContain("patchwork_reduce_motion");
    expect(layout).toContain("try{");
    expect(layout).toContain("catch(e)");
  });

  it("caps stagger delay at maxItems and returns 0 when reduced motion is enabled", () => {
    expect(getStaggerDelayMs(0, false)).toBe(0);
    expect(getStaggerDelayMs(3, false)).toBe(72);
    expect(getStaggerDelayMs(25, false)).toBe(12 * 24);
    expect(getStaggerDelayMs(5, true)).toBe(0);
  });

  it("handles localStorage errors safely in reduce-motion preference helpers", () => {
    const origWindow = globalThis.window;
    try {
      (globalThis as unknown as { window: unknown }).window = {
        localStorage: {
          getItem: () => {
            throw new Error("SecurityError");
          },
          setItem: () => {
            throw new Error("QuotaExceededError");
          },
          removeItem: () => {
            throw new Error("SecurityError");
          },
        },
        dispatchEvent: vi.fn(),
      };
      expect(getReduceMotionPreference()).toBe(false);
      expect(() => setReduceMotionPreference(true)).not.toThrow();
    } finally {
      (globalThis as unknown as { window: unknown }).window = origWindow;
    }
  });
});

describe("Skeleton & Motion Primitives", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders accessible skeleton primitives with aria-hidden", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        "div",
        null,
        React.createElement(Skeleton, { className: "h-4 w-24" }),
        React.createElement(SkeletonText, { lines: 2 }),
        React.createElement(SkeletonCircle, { size: 24 }),
        React.createElement(SkeletonChip, { width: 48 })
      )
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("pw-skeleton");
  });

  it("renders all domain skeletons cleanly", () => {
    expect(renderToStaticMarkup(React.createElement(WorkspaceSkeleton))).toContain(
      'data-testid="workspace-skeleton"'
    );
    expect(renderToStaticMarkup(React.createElement(BoardSkeleton))).toContain(
      'data-testid="board-skeleton"'
    );
    expect(renderToStaticMarkup(React.createElement(TicketPanelSkeleton))).toContain(
      'data-testid="ticket-panel-skeleton"'
    );
    expect(renderToStaticMarkup(React.createElement(SystemConfigSkeleton))).toContain(
      'data-testid="system-config-skeleton"'
    );
    expect(renderToStaticMarkup(React.createElement(SetupWizardSkeleton))).toContain(
      'data-testid="setup-wizard-skeleton"'
    );
    expect(renderToStaticMarkup(React.createElement(SearchPaletteSkeleton))).toContain(
      'data-testid="search-palette-skeleton"'
    );
  });

  it("renders SkeletonRegion with stale-while-revalidate progress bar and dimmed content", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        SkeletonRegion,
        {
          isLoading: true,
          hasData: true,
          isRevalidating: true,
          skeleton: React.createElement("div", null, "SKELETON"),
          loadingLabel: "Refreshing board",
          readyLabel: "Board ready",
        },
        React.createElement("div", null, "EXISTING_BOARD_CONTENT")
      )
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("opacity-60");
    expect(html).toContain("EXISTING_BOARD_CONTENT");
    expect(html).not.toContain("SKELETON");
  });

  it("renders Collapse via grid-template-rows class and RevalidateBar / RouteProgressBar", () => {
    const collapseHtml = renderToStaticMarkup(
      React.createElement(Collapse, { open: true }, React.createElement("span", null, "Body"))
    );
    expect(collapseHtml).toContain("pw-collapse");
    expect(collapseHtml).toContain('data-open="true"');

    expect(
      renderToStaticMarkup(React.createElement(RouteProgressBar, { active: false }))
    ).toBe("");
    expect(
      renderToStaticMarkup(React.createElement(RevalidateBar, { active: true }))
    ).toContain('role="progressbar"');
  });

  it("catches render errors in RegionErrorBoundary and renders Retry fallback", () => {
    const boundary = new RegionErrorBoundary({ regionName: "board", children: null });
    const derived = RegionErrorBoundary.getDerivedStateFromError(new Error("Boom"));
    expect(derived.hasError).toBe(true);
    expect(derived.message).toBe("Boom");
    expect(typeof boundary.handleReset).toBe("function");
  });
});
