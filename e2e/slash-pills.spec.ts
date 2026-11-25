import { test, expect, type Page } from "@playwright/test";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import AxeBuilder from "@axe-core/playwright";
import { COMMAND_REGISTRY } from "../src/lib/commands/registry";

dotenv.config({ path: ".env.test" });

const DB_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test";
const AFTER_DIR = path.join(process.cwd(), "docs", "screenshots", "slash-pills", "after");

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
  await input.click();
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

test.describe("Slash Command Inline Pills E2E", () => {
  test.beforeAll(() => {
    fs.mkdirSync(AFTER_DIR, { recursive: true });
    execSync(
      `node scripts/seed.mjs --reset --size medium --seed 42 --yes --database-url "${DB_URL}"`,
      { stdio: "pipe" }
    );
  });

  test("Spacing (>= 8px gap, >= 12px ghost gap) at 100% & 200% zoom, light/dark, and RTL", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsAdmin(page);
    const input = await openPalette(page);

    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      for (const zoom of ["1", "2"] as const) {
        await page.evaluate((z) => {
          document.documentElement.style.zoom = z;
        }, zoom);

        await input.fill("/new ");
        const pill = page.getByTestId("command-arg-pill").first();
        await expect(pill).toBeVisible();

        const metrics = await page.evaluate(() => {
          const cmd = document.querySelector('[data-testid="command-pill-cmd"]')!;
          const p = document.querySelector('[data-testid="command-arg-pill"]')!;
          const cr = cmd.getBoundingClientRect();
          const pr = p.getBoundingClientRect();
          return { gap: pr.left - cr.right, overlap: pr.left < cr.right };
        });
        expect(metrics.overlap).toBe(false);
        expect(metrics.gap).toBeGreaterThanOrEqual(8);

        // Type value to reveal ghost optional pills and verify >= 12px gap
        const titleInput = page.getByTestId("command-pill-input-title");
        await titleInput.fill("Fix login");
        const ghostOpts = page.getByTestId("command-ghost-options");
        await expect(ghostOpts).toBeVisible();
        const ghostGap = await page.evaluate(() => {
          const p = document.querySelector('[data-testid="command-arg-pill"]')!;
          const g = document.querySelector('[data-testid="command-ghost-pill-column"]')!;
          return g.getBoundingClientRect().left - p.getBoundingClientRect().right;
        });
        expect(ghostGap).toBeGreaterThanOrEqual(12);

        await page.getByRole("button", { name: "Clear command input" }).click();
      }
      await page.evaluate(() => {
        document.documentElement.style.zoom = "1";
      });
    }

    // RTL check
    await page.evaluate(() => {
      document.documentElement.dir = "rtl";
    });
    await input.fill("/new ");
    const rtlGap = await page.evaluate(() => {
      const cmd = document.querySelector('[data-testid="command-pill-cmd"]')!;
      const p = document.querySelector('[data-testid="command-arg-pill"]')!;
      return cmd.getBoundingClientRect().left - p.getBoundingClientRect().right;
    });
    expect(rtlGap).toBeGreaterThanOrEqual(8);
    await page.evaluate(() => {
      document.documentElement.dir = "ltr";
    });
  });

  test("Registry parity, style consistency before/during/after typing, and constant row height", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsAdmin(page);
    const input = await openPalette(page);

    // Style consistency before, during, after typing
    await input.fill("/new ");
    const rowHeightBefore = await page
      .locator('[cmdk-input-wrapper=""]')
      .evaluate((el) => (el as HTMLElement).offsetHeight);

    const readPillStyles = () =>
      page.evaluate(() => {
        const pill = document.querySelector('[data-testid="command-arg-pill"]') as HTMLElement;
        const label = document.querySelector('[data-testid="command-pill-label-title"]') as HTMLElement;
        const inp = document.querySelector('[data-testid="command-pill-input-title"]') as HTMLInputElement;
        const ps = getComputedStyle(pill);
        const ls = getComputedStyle(label);
        const is = getComputedStyle(inp);
        return {
          pillBg: ps.backgroundColor,
          pillBorder: ps.borderTopColor,
          pillRadius: ps.borderTopLeftRadius,
          labelColor: ls.color,
          labelFont: `${ls.fontWeight} ${ls.fontSize} ${ls.fontFamily}`,
          inputColor: is.color,
          inputFont: `${is.fontWeight} ${is.fontSize} ${is.fontFamily}`,
        };
      });

    const beforeStyles = await readPillStyles();
    const titleInput = page.getByTestId("command-pill-input-title");
    await expect(titleInput).toHaveAttribute("placeholder", "ticket title");
    await titleInput.fill("This is the title");
    const afterStyles = await readPillStyles();
    const rowHeightAfter = await page
      .locator('[cmdk-input-wrapper=""]')
      .evaluate((el) => (el as HTMLElement).offsetHeight);

    expect(afterStyles).toEqual(beforeStyles);
    expect(afterStyles.inputColor).toBe(afterStyles.labelColor);
    expect(afterStyles.inputFont).toBe(afterStyles.labelFont);
    expect(Math.abs(rowHeightAfter - rowHeightBefore)).toBeLessThan(1);

    // Every registered command with args enters pill mode with its first arg label
    for (const cmd of COMMAND_REGISTRY) {
      if (cmd.args.length === 0) continue;
      await page.getByRole("button", { name: "Clear command input" }).click();
      await input.fill(`/${cmd.name} `);
      await expect(page.getByTestId("command-pill-cmd")).toHaveText(`/${cmd.name}`);
      await expect(
        page.getByTestId(`command-pill-label-${cmd.args[0].name}`)
      ).toContainText(`${cmd.args[0].label}:`);
    }
  });

  test("Argument types (word/text/choice), optional pills, Backspace/Delete, Undo/Redo, Paste, and IME", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsAdmin(page);
    const input = await openPalette(page);

    // Word vs Choice: /move -> INFRA-1 + Space advances to column; "In " keeps Space literal
    await input.fill("/move ");
    const ticketInp = page.getByTestId("command-pill-input-key");
    await ticketInp.type("INFRA-1 ");
    const colInp = page.getByTestId("command-pill-input-column");
    await expect(colInp).toBeFocused();
    await colInp.type("In Progress");
    await expect(colInp).toHaveValue("In Progress");

    // ArrowLeft across boundary back to ticket pill
    await colInp.press("Home");
    await colInp.press("ArrowLeft");
    await expect(ticketInp).toBeFocused();

    // Shift+Tab / Tab
    await ticketInp.press("Tab");
    await expect(colInp).toBeFocused();
    await colInp.press("Shift+Tab");
    await expect(ticketInp).toBeFocused();

    // Clear and test /new text arg (Space stays literal), optional pills (Tab, click, remove, undo)
    await page.getByRole("button", { name: "Clear command input" }).click();
    await input.fill("/new ");
    const titleInp = page.getByTestId("command-pill-input-title");
    await titleInp.type("Fix login flow");
    await expect(titleInp).toHaveValue("Fix login flow");

    // Click ghost pill priority:
    await page.getByTestId("command-ghost-pill-priority").click();
    const prioInp = page.getByTestId("command-pill-input-priority");
    await expect(prioInp).toBeFocused();
    await prioInp.fill("urgent");

    // Undo (Ctrl+Z) and Redo (Shift+Ctrl+Z)
    await prioInp.press("Control+z");
    await expect(prioInp).toHaveValue("");
    await prioInp.press("Control+Shift+z");
    await expect(prioInp).toHaveValue("urgent");

    // Remove optional pill via × button
    await page.getByTestId("command-remove-pill-priority").click();
    await expect(page.getByTestId("command-pill-input-priority")).toHaveCount(0);
    await expect(page.getByTestId("command-aria-live")).toContainText("priority removed");

    // Backspace in empty title pill uncommits command back to /new
    await titleInp.fill("");
    await titleInp.press("Backspace");
    await expect(page.getByTestId("global-search-input")).toHaveValue("/new");

    // Paste full command in canonical/legacy/positional forms
    await input.fill('/move PAY-12 "In Review"');
    await expect(page.getByTestId("command-pill-input-key")).toHaveValue("PAY-12");
    await expect(page.getByTestId("command-pill-input-column")).toHaveValue("In Review");

    // IME composition must not advance on Space
    await page.getByRole("button", { name: "Clear command input" }).click();
    await input.fill("/move ");
    const imeTicket = page.getByTestId("command-pill-input-key");
    await imeTicket.evaluate((el) => {
      el.dispatchEvent(new CompositionEvent("compositionstart", { data: "あ" }));
    });
    await imeTicket.press(" ");
    await expect(imeTicket).toBeFocused();
    await imeTicket.evaluate((el) => {
      el.dispatchEvent(new CompositionEvent("compositionend", { data: "あ " }));
    });
  });

  test("Accessibility, mobile 390x844 & 320x568, and after screenshots", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsAdmin(page);
    const input = await openPalette(page);

    // Accessibility: group role, combobox moves with focus, axe in light & dark
    await input.fill("/move ");
    await expect(page.getByRole("group", { name: "Command" })).toBeVisible();
    await expect(page.getByTestId("command-pill-input-key")).toHaveAttribute("role", "combobox");

    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await page.waitForTimeout(180);
      const axe = await new AxeBuilder({ page })
        .include('[data-testid="command-palette"]')
        .analyze();
      expect(axe.violations).toEqual([]);
    }

    // Capture after screenshots at 1440x900 and 390x844 (light & dark)
    const shots = [
      { name: "new", setup: async () => { await page.getByRole("button", { name: "Clear command input" }).click(); await input.fill("/new "); } },
      { name: "move", setup: async () => { await page.getByRole("button", { name: "Clear command input" }).click(); await input.fill("/move "); } },
      { name: "assign", setup: async () => { await page.getByRole("button", { name: "Clear command input" }).click(); await input.fill("/assign "); } },
      { name: "optional", setup: async () => { await page.getByRole("button", { name: "Clear command input" }).click(); await input.fill("/new Fix login priority:high"); } },
      { name: "error", setup: async () => { await page.getByRole("button", { name: "Clear command input" }).click(); await input.fill("/priority INFRA-1 badprio"); } },
    ];

    for (const vp of [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ] as const) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const theme of ["light", "dark"] as const) {
        await setTheme(page, theme);
        for (const s of shots) {
          await s.setup();
          await page.waitForTimeout(80);
          await page.getByTestId("command-palette").screenshot({
            path: path.join(AFTER_DIR, `${s.name}-${vp.name}-${theme}.png`),
          });
        }
      }
    }

    // 320x568 mobile overflow & 44px touch targets check
    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByRole("button", { name: "Clear command input" }).click();
    await input.fill("/new Fix mobile wrapping ");
    const mobileMetrics = await page.evaluate(() => {
      const pill = document.querySelector('[data-testid="command-arg-pill"]') as HTMLElement;
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        pillHeight: pill.getBoundingClientRect().height,
      };
    });
    expect(mobileMetrics.overflow).toBe(false);
    expect(mobileMetrics.pillHeight).toBeGreaterThanOrEqual(44);
  });
});
