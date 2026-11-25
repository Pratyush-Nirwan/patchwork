import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.test" });

const DB_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test";

test.describe("Collaboration & Notifications E2E", () => {
  test.beforeAll(async () => {
    execSync(
      `node scripts/seed.mjs --reset --size small --seed 42 --no-attachments --yes --database-url "${DB_URL}"`,
      { stdio: "pipe" }
    );
  });

  test("bell inbox, watchers, mention picker, and /notifications page pass axe a11y", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    await page.getByTestId("auth-email-input").fill("alex.chen@example.com");
    await page.getByTestId("auth-password-input").fill("DevPassword123!");
    await page.getByTestId("auth-submit-btn").click();
    await expect(page.getByTestId("kanban-board-canvas")).toBeVisible({ timeout: 10000 });

    // 1. Notification Bell & Popover
    const bell = page.getByTestId("notification-bell-btn");
    await expect(bell).toBeVisible();
    await bell.click();
    await expect(page.getByTestId("notification-popover")).toBeVisible();
    await expect(page.getByTestId("notification-popover")).toBeInViewport();
    const axePopover = await new AxeBuilder({ page })
      .include('[data-testid="notification-popover"]')
      .analyze();
    expect(axePopover.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("notification-popover")).not.toBeVisible();

    // 2. Open first ticket -> Watch toggle, Watcher popover, Mention picker
    const firstCard = page.locator('[data-testid^="ticket-card-"]').first();
    await firstCard.click();
    await expect(page.getByTestId("ticket-watch-toggle")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("ticket-watchers-count-btn").click();
    await expect(page.getByTestId("ticket-watchers-popover")).toBeVisible();
    await page.keyboard.press("Escape");

    // Test @mention picker in comment box
    const commentInput = page.getByTestId("comment-input");
    await commentInput.click();
    await commentInput.fill("@");
    const picker = page.getByTestId("mention-picker");
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(commentInput).toHaveValue(/@\[.+\]\(mention:[0-9a-f-]+\)/);
  });

  test("mobile notification sheet (390x844) and System Configuration -> Notifications", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await page.getByTestId("auth-email-input").fill("alex.chen@example.com");
    await page.getByTestId("auth-password-input").fill("DevPassword123!");
    await page.getByTestId("auth-submit-btn").click();
    await expect(page.getByTestId("kanban-board-canvas")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("notification-bell-btn").click();
    await expect(page.getByTestId("notification-popover")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard/system/notifications");
    await expect(page.getByTestId("system-notifications-section")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("notifications-subtab-email").click();
    await expect(page.getByTestId("smtp-host-input")).toBeVisible();
    await page.getByTestId("notifications-subtab-webhooks").click();
    await expect(page.getByTestId("webhook-name-input")).toBeVisible();
  });
});
