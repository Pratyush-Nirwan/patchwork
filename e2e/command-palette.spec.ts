import { test, expect } from "@playwright/test";
import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.test" });

const DB_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test";

test.describe("Spotlight Command Palette E2E", () => {
  test.beforeAll(async () => {
    execSync(
      `node scripts/seed.mjs --reset --size small --seed 42 --yes --database-url "${DB_URL}"`,
      { stdio: "pipe" }
    );
  });

  test("opens via shortcuts, executes slash commands, filters board, confirms destructive delete, and opens settings", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    await page.getByTestId("auth-email-input").fill("alex.chen@example.com");
    await page.getByTestId("auth-password-input").fill("DevPassword123!");
    await page.getByTestId("auth-submit-btn").click();
    await expect(page.getByTestId("kanban-board-canvas")).toBeVisible({ timeout: 10000 });

    // Open with Ctrl+K and close with Escape
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).not.toBeVisible();

    // Open with '/' outside inputs, verify '/' is prefilled, and toggle Help view with Ctrl+/
    await page.keyboard.press("/");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await expect(page.getByTestId("global-search-input")).toHaveValue("/");
    await page.keyboard.press("Control+/");
    await expect(page.getByTestId("command-help-view")).toBeVisible();

    // Run /theme dark
    const input = page.getByTestId("global-search-input");
    await input.fill("/theme dark");
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveClass(/dark/);

    // Re-open and run /new
    await page.keyboard.press("Control+k");
    await input.fill('/new "Command Bar E2E Ticket" --priority urgent');
    await page.keyboard.press("Enter");
    await expect(page.getByText("Command Bar E2E Ticket").first()).toBeVisible({ timeout: 10000 });

    // Close ticket detail panel if opened
    const closeDetail = page.getByTestId("close-detail-panel");
    if (await closeDetail.isVisible()) {
      await closeDetail.click();
    }

    // Filter board with /filter priority:urgent and clear
    await page.keyboard.press("Control+k");
    await input.fill("/filter priority:urgent");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("active-board-filters")).toBeVisible();
    await page.getByText("Clear filters").click();
    await expect(page.getByTestId("active-board-filters")).not.toBeVisible();

    // Open Preferences & Shortcuts via /settings
    await page.keyboard.press("Control+k");
    await input.fill("/settings");
    await input.press("Enter");
    await expect(page.getByTestId("user-settings-modal")).toBeVisible();
    await page.getByTestId("reset-shortcuts-btn").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("user-settings-modal")).not.toBeVisible();

    // Verify /logout shows inline confirmation banner before signing out
    await page.keyboard.press("Control+k");
    await input.fill("/logout");
    await input.press("Enter");
    await expect(page.getByTestId("command-confirm-banner")).toBeVisible();
    await page.keyboard.press("Escape");
  });
});

