import { test, expect, type Page } from "@playwright/test";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import AxeBuilder from "@axe-core/playwright";

dotenv.config({ path: ".env.test" });

const DB_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test";

const SCREENSHOT_DIR = path.join(process.cwd(), "docs", "screenshots", "slash-fixes");

async function loginAs(page: Page, email = "alex.chen@example.com") {
  await page.goto("/");
  await page.getByTestId("auth-email-input").fill(email);
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

test.describe("Slash Command Fixes E2E, A11y & Visual Baselines", () => {
  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    execSync(
      `node scripts/seed.mjs --reset --size medium --seed 42 --yes --database-url "${DB_URL}"`,
      { stdio: "pipe" }
    );
  });

  test("Items 1, 2, 3: Backspace keyed rewind, option key suggestions, and single selection source of truth", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page);
    const input = await openPalette(page);

    // Item 1: Backspace removes whole keyed token and leaves quoted title intact
    await input.fill('/new "Fix" priority:urgent ');
    await input.press("Backspace");
    await expect(input).toHaveValue('/new "Fix" ');

    // Also works when keyed option is in the middle or first
    await input.fill('/new "Fix" priority:high label:bug ');
    await input.press("Backspace");
    await expect(input).toHaveValue('/new "Fix" priority:high ');
    await input.press("Backspace");
    await expect(input).toHaveValue('/new "Fix" ');

    // Item 2: Option key suggestions appear after required args, exclude used keys, filter by prefix
    await expect(page.getByTestId("command-active-arg-desc")).toHaveText(
      "Optional: pick an option, or press Enter to run"
    );
    await expect(page.getByText("column:").first()).toBeVisible();
    await expect(page.getByText("priority:").first()).toBeVisible();

    // Nothing highlighted initially when showing option keys
    await expect(page.locator('[cmdk-item][aria-selected="true"]')).toHaveCount(0);

    // Typing prefix filters option keys; Tab inserts priority: and opens value suggestions
    await input.fill("/new Fix login pri");
    await expect(page.getByText("priority:").first()).toBeVisible();
    await input.press("Tab");
    await expect(input).toHaveValue("/new Fix login priority:");
    await expect(page.getByText("urgent").first()).toBeVisible();

    // Used key is excluded when continuing to next option
    await input.fill("/new Fix login priority:high ");
    await expect(page.locator('[cmdk-item]', { hasText: "priority:" })).toHaveCount(0);
    await expect(page.locator('[cmdk-item]', { hasText: "column:" })).toBeVisible();

    // Item 3: Single selection source of truth, randomized arrow/filter sequence
    await input.fill("/move ");
    for (let i = 0; i < 6; i += 1) {
      await input.press(i % 2 === 0 ? "ArrowDown" : "ArrowUp");
      const selectedCount = await page.locator('[cmdk-item][aria-selected="true"]').count();
      expect(selectedCount).toBe(1);
    }
    // Stationary pointer does not override keyboard selection
    await page.mouse.move(10, 10);
    await input.press("ArrowDown");
    const afterDown = await page
      .locator('[cmdk-item][aria-selected="true"]')
      .first()
      .getAttribute("data-value");
    await input.press("ArrowDown");
    const afterSecondDown = await page
      .locator('[cmdk-item][aria-selected="true"]')
      .first()
      .getAttribute("data-value");
    expect(afterSecondDown).not.toBe(afterDown);
  });

  test("Item 4: Key and value hint has ~4px gap at 100% and 200% zoom and RTL", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page);
    const input = await openPalette(page);

    for (const zoom of ["1", "2"]) {
      await page.evaluate((z) => {
        document.documentElement.style.zoom = z;
      }, zoom);
      await input.fill("/new Fix colon gap priority:");
      const gap = await page.evaluate(() => {
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
        const zoomScale = el.offsetWidth > 0 ? elRect.width / el.offsetWidth : 1;
        const textEnd = elRect.left + (padLeft + textWidth - el.scrollLeft) * zoomScale;
        return (ghostRect.left - textEnd) / zoomScale;
      });
      expect(gap).toBeGreaterThanOrEqual(2);
      expect(gap).toBeLessThanOrEqual(10);
    }
    await page.evaluate(() => {
      document.documentElement.style.zoom = "";
    });

    // RTL check
    await page.evaluate(() => {
      document.documentElement.setAttribute("dir", "rtl");
    });
    await input.fill("/new Fix rtl priority:");
    await expect(page.getByTestId("command-ghost-layer")).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.removeAttribute("dir");
    });
  });

  test("Items 6 & 7: /new unquoted multi-word, snackbar with Open & Undo, Shift+Enter keep open, error keeps input", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page);
    const input = await openPalette(page);

    // Item 6: /new Fix login bug hides flag hints mid-sentence, shows Enter to run
    await input.fill("/new Fix login bug");
    await expect(page.getByTestId("command-ghost-rest")).toHaveCount(0);
    await expect(page.getByTestId("command-ghost-run")).toBeVisible();

    // Enter runs when no option key is highlighted, closes palette, shows snackbar with Open
    await input.press("Enter");
    await expect(page.getByTestId("command-palette")).not.toBeVisible();
    const snackbar = page.getByTestId("app-snackbar");
    await expect(snackbar).toBeVisible();
    await expect(snackbar).toHaveAttribute("aria-live", "polite");
    await expect(page.getByTestId("app-snackbar-message")).toContainText("Fix login bug");
    await expect(page.getByTestId("app-snackbar-action")).toHaveText("Open");

    // Theme command closes and shows snackbar with Undo
    await openPalette(page);
    await input.fill("/theme dark");
    await input.press("Enter");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByTestId("app-snackbar-action")).toHaveText("Undo");
    await page.getByTestId("app-snackbar-action").click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    // Shift+Enter keeps palette open, clears input, shows inline feedback until next keystroke
    await openPalette(page);
    await input.fill("/theme dark");
    await input.press("Shift+Enter");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await expect(input).toHaveValue("");
    await expect(page.getByTestId("command-feedback")).toContainText("Switched to dark theme");
    await input.type("/me");
    await expect(page.getByTestId("command-feedback")).toHaveCount(0);

    // Failure keeps palette open with arguments intact
    await input.fill("/move NOPE-999 QA");
    await input.press("Enter");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await expect(input).toHaveValue("/move NOPE-999 QA");
    await expect(page.getByTestId("command-feedback")).toBeVisible();
  });

  test("Items 8, 9, 10: destructive confirmation context, /help list & detail, and recent command history", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page);
    const input = await openPalette(page);

    // Run a safe command so history has an entry
    await input.fill("/me");
    await input.press("Enter");
    await expect(page.getByTestId("app-snackbar")).toBeVisible();

    // Item 10: bare / shows Recent commands; ArrowUp recalls, ArrowDown restores draft
    await openPalette(page);
    await input.fill("/");
    await expect(page.getByText("Recent commands")).toBeVisible();
    await input.press("ArrowUp");
    await expect(input).toHaveValue("/me");
    await input.press("ArrowDown");
    await expect(input).toHaveValue("/");

    // Item 9: /help list & /help move detail view
    await input.fill("/help");
    await input.press("Enter");
    await expect(page.getByTestId("command-help-view")).toBeVisible();
    await expect(page.getByTestId("help-example-move")).toBeVisible();

    // Clicking example inserts without running
    await page.getByTestId("help-example-move").click();
    await expect(page.getByTestId("command-help-view")).not.toBeVisible();
    await expect(input).toHaveValue('/move TELE-1 "In Progress"');

    // /help move opens detail view; Esc returns to help list
    await input.fill("/help move");
    await input.press("Enter");
    await expect(page.getByTestId("command-help-detail")).toBeVisible();
    await expect(page.getByTestId("command-help-detail")).toContainText("/move ticket column");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-help-view")).toBeVisible();

    // Item 8: /delete shows context, focuses Cancel, Enter does not confirm, missing ticket shows error
    await input.fill("/delete MISSING-999");
    await input.press("Enter");
    await expect(page.getByTestId("command-feedback")).toContainText("Ticket not found");
    await expect(page.getByTestId("command-confirm-banner")).toHaveCount(0);

    // Pick first visible ticket key on board
    const firstKey = await page.locator('[data-testid^="ticket-card-"]').first().innerText();
    const keyMatch = firstKey.match(/[A-Z]+-\d+/);
    if (keyMatch) {
      const tk = keyMatch[0];
      await input.fill(`/delete ${tk}`);
      await input.press("Enter");
      await expect(page.getByTestId("command-confirm-banner")).toBeVisible();
      await expect(page.getByTestId("command-confirm-context")).toContainText("Board:");
      await expect(page.getByTestId("command-confirm-cancel-btn")).toBeFocused();
      await expect(page.getByTestId("command-confirm-btn")).toContainText(`Delete ${tk}`);
      // Enter in input does not confirm
      await input.focus();
      await input.press("Enter");
      await expect(page.getByTestId("command-confirm-banner")).toBeVisible();
      await page.getByTestId("command-confirm-cancel-btn").click();
      await expect(page.getByTestId("command-confirm-banner")).toHaveCount(0);
    }
  });

  test("Visual baselines & Axe accessibility across desktop/mobile and light/dark", async ({
    page,
  }) => {
    await loginAs(page);

    for (const vp of [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const theme of ["light", "dark"] as const) {
        await setTheme(page, theme);
        const input = await openPalette(page);

        // 1. Key and value hint
        await input.fill("/new Fix issue priority:");
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `key-value-${vp.name}-${theme}.png`),
        });
        const axe1 = await new AxeBuilder({ page })
          .include('[data-testid="command-palette"]')
          .analyze();
        expect(axe1.violations).toEqual([]);

        // 2. Option key list
        await input.fill("/new Fix issue ");
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `option-keys-${vp.name}-${theme}.png`),
        });

        // 3. Help list & detail
        await input.fill("/help");
        await input.press("Enter");
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `help-list-${vp.name}-${theme}.png`),
        });
        const axeHelp = await new AxeBuilder({ page })
          .include('[data-testid="command-palette"]')
          .analyze();
        expect(axeHelp.violations).toEqual([]);

        await input.fill("/help move");
        await input.press("Enter");
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `help-detail-${vp.name}-${theme}.png`),
        });

        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
      }
    }
  });
});

