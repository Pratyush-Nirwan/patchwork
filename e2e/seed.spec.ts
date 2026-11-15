import { test, expect } from "@playwright/test";
import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.test" });

const DB_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test";

test.describe("Seeded Workspace E2E Smoke Test", () => {
  test.beforeAll(async () => {
    // Seed small volume to patchwork_test
    execSync(
      `node scripts/seed.mjs --reset --size small --seed 42 --yes --database-url "${DB_URL}"`,
      { stdio: "pipe" }
    );
  });

  test("loads seeded workspace: login, board pages, ticket details, search, and user lists without errors", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. Visit root -> since setup is completed, should show login page
    await page.goto("/");
    await expect(page).toHaveURL("http://localhost:3000/");

    // Login with seeded admin
    await page.getByTestId("auth-email-input").fill("alex.chen@example.com");
    await page.getByTestId("auth-password-input").fill("DevPassword123!");
    await page.getByTestId("auth-submit-btn").click();

    // 2. Workspace loads -> verify organization name and navigation
    await expect(page.getByTestId("org-item-acme-corp")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Cloud Infrastructure & IaC").first()).toBeVisible();

    // 3. Click into a board
    await page.getByText("Cloud Infrastructure & IaC").first().click();
    await expect(page.getByRole("heading", { name: "Backlog" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "In Progress" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();

    // 4. Click a ticket to view ticket details modal
    const ticketCard = page.locator("[data-testid^='ticket-card-']").first();
    await expect(ticketCard).toBeVisible();
    await ticketCard.click();

    // Verify ticket details modal: description, comments
    await expect(page.getByText(/Environment: production/i)).toBeVisible();
    await expect(page.getByPlaceholder("Write a markdown comment...")).toBeVisible();

    // Close ticket modal
    await page.keyboard.press("Escape");

    // 5. Search workspace via Command Palette
    await page.getByTestId("command-palette-trigger").click();
    const searchInput = page.getByTestId("global-search-input");
    await searchInput.fill("Redis");

    // Verify search matches
    await expect(page.getByTestId("search-results")).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Escape");

    // 6. Navigate to Team Members / Users view
    const teamNav = page.getByText("Platform Infrastructure").first();
    await expect(teamNav).toBeVisible();

    // 7. Toggle between Kanban board and Calendar view
    const viewSwitcher = page.getByTestId("board-view-switcher");
    await expect(viewSwitcher).toBeVisible();

    const calBtn = page.getByTestId("view-switcher-calendar");
    await calBtn.click();
    await expect(page.getByTestId("board-calendar-view")).toBeVisible();
    await expect(page.getByTestId("calendar-month-heading")).toBeVisible();

    const boardBtn = page.getByTestId("view-switcher-kanban");
    await boardBtn.click();
    await expect(page.getByTestId("kanban-board-canvas")).toBeVisible();
  });
});

