import { expect, test } from "@playwright/test";

test.describe("External Documentation Links", () => {
  test("login footer and workspace sidebar link to https://getpatchwork.in/documentation/", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    const loginDocs = page.getByTestId("login-docs-link");
    await expect(loginDocs).toBeVisible();
    await expect(loginDocs).toHaveAttribute("href", "https://getpatchwork.in/documentation/");
    await expect(loginDocs).toHaveAttribute("target", "_blank");

    await page.getByTestId("auth-email-input").fill("alex.chen@example.com");
    await page.getByTestId("auth-password-input").fill("DevPassword123!");
    await page.getByTestId("auth-submit-btn").click();
    await expect(page.getByTestId("kanban-board-canvas")).toBeVisible({ timeout: 10000 });

    const sidebarDocs = page.getByTestId("nav-documentation");
    await expect(sidebarDocs).toBeVisible();
    await expect(sidebarDocs).toHaveAttribute("href", "https://getpatchwork.in/documentation/");
    await expect(sidebarDocs).toHaveAttribute("target", "_blank");
  });
});
