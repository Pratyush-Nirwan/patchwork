import { test, expect, type Page } from "@playwright/test";
import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.test" });

const DB_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test";

async function loginAsAdmin(page: Page) {
  await page.goto("/");
  await page.getByTestId("auth-email-input").fill("alex.chen@example.com");
  await page.getByTestId("auth-password-input").fill("DevPassword123!");
  await page.getByTestId("auth-submit-btn").click();
  await expect(page.getByTestId("kanban-board-canvas")).toBeVisible({ timeout: 15000 });
}

test.describe("Version Display & Layout Stability (v0.7.0-beta)", () => {
  test.beforeAll(() => {
    execSync(
      `node scripts/seed.mjs --reset --size small --seed 42 --yes --database-url "${DB_URL}"`,
      { stdio: "pipe" }
    );
  });

  test("shows v0.7.0-beta in sidebar and About section in light/dark at 390 and 1440 widths with no layout shift", async ({
    page,
  }) => {
    await loginAsAdmin(page);

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
        await expect(sidebarVer).toBeVisible();
        await expect(sidebarVer).toHaveText("v0.7.0-beta");

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
    await expect(page.getByTestId("about-version")).toHaveText("v0.7.0-beta");
  });

  test("docs site landing badge and footer display v0.7.0-beta", async ({ page }) => {
    await page.goto("/documentation");
    await expect(page.getByTestId("docs-landing-version")).toContainText("v0.7.0-beta");
    await expect(page.getByTestId("docs-footer-version")).toHaveText("v0.7.0-beta");
  });
});
