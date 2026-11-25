import { test, expect, type Page } from "@playwright/test";
import { execSync } from "child_process";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.test" });

const PKG = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")
) as { version: string };
const VERSION_LABEL = `v${PKG.version}`;

const DB_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test";

async function loginAsAdmin(page: Page) {
  await page.goto("/");
  await page.getByTestId("auth-email-input").fill("alex.chen@example.com");
  await page.getByTestId("auth-password-input").fill("DevPassword123!");
  await page.getByTestId("auth-submit-btn").click();
  await expect(page.getByTestId("kanban-board-canvas")).toBeVisible({ timeout: 15000 });
}

test.describe("Version Display & Layout Stability", () => {
  test.beforeAll(() => {
    execSync(
      `node scripts/seed.mjs --reset --size small --seed 42 --yes --database-url "${DB_URL}"`,
      { stdio: "pipe" }
    );
  });

  test("shows current version in sidebar and About section in light/dark at 390 and 1440 widths with no layout shift", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await expect(page.getByTestId("left-sidebar").or(page.getByRole("button", { name: "Toggle Sidebar" })).first()).toBeVisible({
      timeout: 15000,
    });

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const dark of [false, true]) {
        await page.evaluate((isDark) => {
          document.documentElement.classList.toggle("dark", isDark);
        }, dark);

        const sidebar = page.getByTestId("left-sidebar");
        if (!(await sidebar.isVisible())) {
          await page.getByRole("button", { name: "Toggle Sidebar" }).click();
        }

        const sidebarVer = page.getByTestId("sidebar-version");
        await expect(sidebarVer).toBeVisible({ timeout: 10000 });
        await expect(sidebarVer).toHaveText(VERSION_LABEL);

        const cls = await page.evaluate(() => {
          return performance
            .getEntriesByType("layout-shift")
            .filter((e) => !(e as unknown as { hadRecentInput?: boolean }).hadRecentInput)
            .reduce((sum, e) => sum + ((e as unknown as { value?: number }).value || 0), 0);
        });
        expect(cls).toBeLessThan(0.05);
      }
    }

    // Open Preferences / About modal via Command Palette /settings
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.getByTestId("global-search-input").fill("/settings");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("about-patchwork-section")).toBeVisible();
    await expect(page.getByTestId("about-version")).toHaveText(VERSION_LABEL);
  });

  test("docs site landing badge and footer display current version", async ({ page }) => {
    await page.goto("/documentation");
    await expect(page.getByTestId("docs-landing-version")).toContainText(VERSION_LABEL);
    await expect(page.getByTestId("docs-footer-version")).toHaveText(VERSION_LABEL);
  });
});
