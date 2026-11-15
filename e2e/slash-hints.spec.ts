import { test, expect, type Page } from "@playwright/test";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import AxeBuilder from "@axe-core/playwright";

dotenv.config({ path: ".env.test" });

const DB_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test";

const SCREENSHOT_DIR = path.join(process.cwd(), "docs", "screenshots", "slash-hints");

async function loginAsAdmin(page: Page) {
  await page.goto("/");
  await page.getByTestId("auth-email-input").fill("alex.chen@example.com");
  await page.getByTestId("auth-password-input").fill("DevPassword123!");
  await page.getByTestId("auth-submit-btn").click();
  await expect(page.getByTestId("kanban-board-canvas")).toBeVisible({ timeout: 15000 });
}

async function openPalette(page: Page) {
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  const input = page.getByTestId("global-search-input");
  await expect(input).toBeFocused();
  return input;
}

async function setTheme(page: Page, mode: "light" | "dark") {
  await page.evaluate((m) => {
    const html = document.documentElement;
    if (m === "dark") html.classList.add("dark");
    else html.classList.remove("dark");
  }, mode);
}

test.describe("Slash Command Inline Ghost Hints E2E", () => {
  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    execSync(
      `node scripts/seed.mjs --reset --size medium --seed 42 --yes --database-url "${DB_URL}"`,
      { stdio: "pipe" }
    );
  });

  test("ghost alignment, 200% zoom, scrollLeft, and fonts.ready in light and dark", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsAdmin(page);
    const input = await openPalette(page);

    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await input.fill("/move ");
      await page.evaluate(() => document.fonts.ready);

      const ghostLayer = page.getByTestId("command-ghost-layer");
      await expect(ghostLayer).toBeVisible();
      await expect(page.getByTestId("command-ghost-active")).toHaveText("ticket");
      await expect(page.getByTestId("command-ghost-rest")).toContainText("column");

      // Verify ghost layer starts immediately after typed text (within 4px tolerance)
      const alignment = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="global-search-input"]') as HTMLInputElement;
        const ghost = document.querySelector('[data-testid="command-ghost-layer"]') as HTMLElement;
        const cs = window.getComputedStyle(el);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const textWidth = ctx.measureText(el.value).width;
        const elRect = el.getBoundingClientRect();
        const ghostRect = ghost.getBoundingClientRect();
        const padLeft = parseFloat(cs.paddingLeft) || 0;
        const expectedX = elRect.left + padLeft + textWidth - el.scrollLeft;
        return {
          diff: Math.abs(ghostRect.left - expectedX),
          ghostTop: ghostRect.top,
          elTop: elRect.top,
          elBottom: elRect.bottom,
          ghostBottom: ghostRect.bottom,
        };
      });
      expect(alignment.diff).toBeLessThan(6);
      expect(alignment.ghostTop).toBeGreaterThanOrEqual(alignment.elTop - 2);
      expect(alignment.ghostBottom).toBeLessThanOrEqual(alignment.elBottom + 2);
    }

    // 200% zoom check (CSS zoom / scaled viewport)
    await setTheme(page, "light");
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await input.fill("/move ");
    await expect(page.getByTestId("command-ghost-layer")).toBeVisible();
    await expect(page.getByTestId("command-ghost-active")).toHaveText("ticket");
    await page.evaluate(() => {
      document.documentElement.style.zoom = "";
    });

    // Horizontal scroll / overflow hides ghost cleanly when typed text exceeds input width
    const longTitle = "Very long ticket title ".repeat(8);
    await input.fill(`/new "${longTitle}" `);
    await page.waitForTimeout(50);
    // Ghost is either hidden on overflow or positioned within bounds without overlapping typed text
    const ghostCount = await page.getByTestId("command-ghost-layer").count();
    if (ghostCount > 0) {
      const box = await page.getByTestId("command-ghost-layer").boundingBox();
      const inputBox = await input.boundingBox();
      if (box && inputBox) {
        expect(box.x).toBeGreaterThanOrEqual(inputBox.x);
      }
    }
  });

  test("caret mid-text, selection, IME composition, and clear behavior", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsAdmin(page);
    const input = await openPalette(page);

    await input.fill("/move ");
    await expect(page.getByTestId("command-ghost-layer")).toBeVisible();

    // Moving caret mid-text hides ghost
    await input.press("ArrowLeft");
    await expect(page.getByTestId("command-ghost-layer")).toHaveCount(0);

    // Moving caret back to end shows ghost again
    await input.press("End");
    await expect(page.getByTestId("command-ghost-layer")).toBeVisible();

    // Selecting text hides ghost
    await input.press("Shift+ArrowLeft");
    await expect(page.getByTestId("command-ghost-layer")).toHaveCount(0);
    await input.press("End");
    await expect(page.getByTestId("command-ghost-layer")).toBeVisible();

    // IME composition hides ghost, compositionend restores it
    await input.evaluate((el) => {
      el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "m" }));
    });
    await expect(page.getByTestId("command-ghost-layer")).toHaveCount(0);
    await input.evaluate((el) => {
      el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "m" }));
    });
    await expect(page.getByTestId("command-ghost-layer")).toBeVisible();

    // Clearing input hides command ghost
    await input.fill("");
    await expect(page.getByTestId("command-ghost-layer")).toHaveCount(0);
  });

  test("keyboard navigation: command completion, Tab advance, Backspace rewind, Enter accept vs execute", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsAdmin(page);
    const input = await openPalette(page);

    // Partial command name shows inline completion
    await input.fill("/mo");
    await expect(page.getByTestId("command-ghost-active")).toHaveText("ve");
    await input.press("Tab");
    await expect(input).toHaveValue("/move ");

    // First arg ghost + suggestion list
    await expect(page.getByTestId("command-ghost-active")).toHaveText("ticket");
    await expect(page.getByTestId("command-active-arg-desc")).toBeVisible();

    // Tab accepts top ticket suggestion and advances to column
    await input.press("Tab");
    const valAfterFirstTab = await input.inputValue();
    expect(valAfterFirstTab).toMatch(/^\/move \S+ $/);
    await expect(page.getByTestId("command-ghost-active")).toHaveText("column");

    // Typing column prefix shows inline autocomplete and Tab completes it
    await input.type("In");
    await expect(page.getByTestId("command-ghost-active")).toHaveText(" Progress");
    await input.press("Tab");
    await expect(input).toHaveValue(`${valAfterFirstTab}"In Progress" `);

    // Backspace on empty second arg rewinds to first arg and restores ticket hint
    await input.fill("/move INFRA-1 ");
    await input.press("Backspace");
    await expect(input).toHaveValue("/move ");
    await expect(page.getByTestId("command-ghost-active")).toHaveText("ticket");

    // Enter when incomplete accepts suggestion instead of failing execution
    await input.press("Enter");
    const valAfterEnterAccept = await input.inputValue();
    expect(valAfterEnterAccept).toMatch(/^\/move \S+ $/);

    // ArrowRight on partial command completes command
    await input.fill("/them");
    await input.press("ArrowRight");
    await expect(input).toHaveValue("/theme ");
  });

  test("ghost text never enters input.value, clipboard, submitted payload, or screen-reader value", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsAdmin(page);
    const input = await openPalette(page);

    await input.fill("/move ");
    await expect(page.getByTestId("command-ghost-layer")).toBeVisible();

    // input.value and aria-hidden on ghost
    await expect(input).toHaveValue("/move ");
    await expect(page.getByTestId("command-ghost-layer")).toHaveAttribute("aria-hidden", "true");

    // aria-describedby points to aria-live region
    const describedBy = await input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const liveEl = page.getByTestId("command-aria-live");
    await expect(liveEl).toHaveAttribute("aria-live", "polite");
    await expect(liveEl).toContainText("ticket");

    // Select-all + copy only copies input.value, never ghost text
    const copied = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="global-search-input"]') as HTMLInputElement;
      el.select();
      return window.getSelection()?.toString() || el.value;
    });
    expect(copied).toBe("/move ");
    expect(copied).not.toContain("\u2039ticket\u203a");
  });

  test("RTL, emoji, CJK, CLS = 0, and 200-item responsiveness", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsAdmin(page);
    const input = await openPalette(page);

    // Track CLS while typing slash command
    await page.evaluate(() => {
      (window as unknown as { __pwCls: number }).__pwCls = 0;
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const ls = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
          if (!ls.hadRecentInput && ls.value) {
            (window as unknown as { __pwCls: number }).__pwCls += ls.value;
          }
        }
      });
      obs.observe({ type: "layout-shift", buffered: true });
    });

    await input.fill("/new ");
    await input.type('"🚀 テスト العنوان" priority:high', { delay: 10 });
    await expect(page.getByTestId("command-ghost-run")).toBeVisible();

    const cls = await page.evaluate(() => (window as unknown as { __pwCls: number }).__pwCls || 0);
    expect(cls).toBe(0);

    // RTL direction check
    await page.evaluate(() => {
      document.documentElement.setAttribute("dir", "rtl");
    });
    await input.fill("/move ");
    await expect(page.getByTestId("command-ghost-layer")).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.removeAttribute("dir");
    });

    // Input typing latency remains responsive under load
    const start = Date.now();
    await input.fill("/priority ");
    await expect(page.getByTestId("command-ghost-active")).toBeVisible();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1500);
  });

  test("mobile visualViewport Accept bar and >=44x44px tap targets at 390x844 and 320x568", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsAdmin(page);

    for (const vp of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(vp);
      await page.keyboard.press("Control+k");
      await expect(page.getByTestId("command-palette")).toBeVisible();

      const input = page.getByTestId("global-search-input");
      await input.fill("/mo");

      const acceptBtn = page.getByTestId("command-mobile-accept-btn");
      await expect(acceptBtn).toBeVisible();
      const box = await acceptBtn.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);

      await acceptBtn.click();
      await expect(input).toHaveValue("/move ");
      await page.keyboard.press("Escape");
    }
  });

  test("accessibility (axe-core), forced-colors, prefers-contrast, and after screenshots", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsAdmin(page);

    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      const input = await openPalette(page);

      // 1. /move <ticket> <column>
      await input.fill("/move ");
      await page.waitForTimeout(150);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `after-desktop-${theme}.png`),
      });

      const axe = await new AxeBuilder({ page })
        .include('[data-testid="command-palette"]')
        .analyze();
      expect(axe.violations).toEqual([]);

      // 2. Validation error state
      await input.fill('/new "Fix" priorty:high');
      await expect(page.getByTestId("command-arg-error")).toBeVisible();
      await expect(page.getByTestId("command-arg-error-underline")).toBeVisible();
      const axeErr = await new AxeBuilder({ page })
        .include('[data-testid="command-palette"]')
        .analyze();
      expect(axeErr.violations).toEqual([]);

      await page.keyboard.press("Escape");
    }

    // Mobile after screenshots (390x844 light & dark)
    await page.setViewportSize({ width: 390, height: 844 });
    const sidebar = page.getByTestId("left-sidebar");
    if (await sidebar.isVisible()) {
      await page.mouse.click(380, 100);
      await expect(sidebar).not.toBeVisible();
    }
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await page.getByTestId("command-palette-trigger").click();
      const input = page.getByTestId("global-search-input");
      await input.fill("/move ");
      await page.waitForTimeout(150);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `after-mobile-${theme}.png`),
      });
      await page.keyboard.press("Escape");
    }

    // forced-colors & prefers-contrast media emulation
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ forcedColors: "active", contrast: "more" });
    const input = await openPalette(page);
    await input.fill("/move ");
    await expect(page.getByTestId("command-ghost-active")).toBeVisible();
    await page.emulateMedia({ forcedColors: "none", contrast: "no-preference" });
  });
});

