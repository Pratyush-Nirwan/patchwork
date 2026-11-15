import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import pg from "pg";
import dotenv from "dotenv";
import { createAndStoreAdminToken } from "../scripts/setup/token.mjs";

dotenv.config({ path: ".env.test" });

let initialAdminSetupToken = "";

test.describe("Patchwork E2E Suite", () => {
  test.beforeAll(async () => {
    const dbUrl =
      process.env.DATABASE_URL ||
      "postgres://postgres:postgres@localhost:5432/patchwork_test";
    const pool = new pg.Pool({ connectionString: dbUrl });
    try {
      await pool.query(
        "TRUNCATE setup_token, setup_state, users, sessions, orgs, org_members, teams, team_members, projects, boards, columns, tickets, ticket_comments, ticket_activities, ticket_attachments, ticket_links, system_settings CASCADE"
      );
    } finally {
      await pool.end();
    }

    const tokenRes = await createAndStoreAdminToken({
      databaseUrl: dbUrl,
      encryptionKey:
        process.env.TOKEN_ENCRYPTION_KEY ||
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      confirmed: true,
    });
    initialAdminSetupToken = tokenRes.tokenBuffer.toString("utf8");
    tokenRes.tokenBuffer.fill(0);
  });

  test("first-run setup wizard (redirect, autosave, logout/resume, CSV import, forced password change, lock) and full workspace workflow", async ({
    page,
    browser,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const email = "grace.hopper@orbital.dev";
    const password = "PatchworkE2EPassword!";

    // 1. Fresh install redirects / to /setup
    await page.goto("/");
    await expect(page).toHaveURL(/\/setup/);
    await expect(page.getByTestId("setup-notice-banner")).toContainText(
      "Setup takes some time. Every step is saved automatically, so you can close this page and resume whenever you want."
    );

    // Step 1: Register first admin with single-use setup token
    await page.getByTestId("setup-admin-token").fill(initialAdminSetupToken);
    await page.getByTestId("setup-admin-name").fill("Grace Hopper");
    await page.getByTestId("setup-admin-email").fill(email);
    await page.getByTestId("setup-admin-password").fill(password);
    await page.getByTestId("setup-step-1-submit").click();

    // Lands on Step 2 (Organization)
    await expect(page.getByTestId("setup-step-2-form")).toBeVisible();
    await expect(page.getByTestId("setup-step-status-1")).toHaveText("done");
    await expect(page.getByTestId("setup-step-status-2")).toHaveText(
      "in progress"
    );

    // Enter draft organization name & description, wait for autosave, then sign out and resume
    await page.getByTestId("setup-org-name").fill("Orbital Systems");
    await page
      .getByTestId("setup-org-description")
      .fill("Deep-space telemetry and guidance division.");
    await expect(page.getByTestId("setup-autosave-status")).toContainText(
      "All changes saved",
      { timeout: 5000 }
    );

    // Sign out during setup and verify resume login restores Step 2 + draft fields
    await page.getByTestId("setup-logout-btn").click();
    await expect(page.getByTestId("setup-resume-login-form")).toBeVisible();
    await page.getByTestId("setup-login-email").fill(email);
    await page.getByTestId("setup-login-password").fill(password);
    await page.getByTestId("setup-login-submit").click();

    await expect(page.getByTestId("setup-step-2-form")).toBeVisible();
    await expect(page.getByTestId("setup-org-name")).toHaveValue(
      "Orbital Systems"
    );
    await expect(page.getByTestId("setup-org-description")).toHaveValue(
      "Deep-space telemetry and guidance division."
    );
    await page.getByTestId("setup-step-2-submit").click();

    // Step 3: Teams
    await expect(page.getByTestId("setup-step-3-form")).toBeVisible();
    await page.getByTestId("setup-team-name-0").fill("Flight Control");
    await page
      .getByTestId("setup-team-lead-0")
      .fill("lead@orbital.dev");
    await page.getByTestId("setup-step-3-submit").click();

    // Step 4: Employees (CSV Import validation + valid CSV import)
    await expect(page.getByTestId("setup-step-4-form")).toBeVisible();

    // First verify invalid CSV row is reported, not silently dropped
    await page
      .getByTestId("setup-csv-textarea")
      .fill("name,email,role,team,password\n,bad-email,badrole,flight-control,123");
    await page.getByTestId("setup-csv-import-btn").click();
    await expect(page.getByTestId("setup-csv-errors")).toBeVisible();

    // Now import valid employees via CSV
    const validCsv = [
      "name,email,role,team,password",
      "Alan Shepard,lead@orbital.dev,team lead,flight-control,TempPass123!",
      "Margaret Hamilton,member@orbital.dev,member,flight-control,TempPass123!",
      "Katherine Johnson,viewer@orbital.dev,viewer,flight-control,TempPass123!",
    ].join("\n");
    await page.getByTestId("setup-csv-textarea").fill(validCsv);
    await page.getByTestId("setup-csv-import-btn").click();

    // Lands on Step 5 (Projects) and shows provisioned temporary credentials
    await expect(page.getByTestId("setup-step-5-form")).toBeVisible();
    await expect(page.getByTestId("setup-generated-credentials")).toBeVisible();

    await page.getByTestId("setup-proj-name-0").fill("Telemetry Core");
    await page.getByTestId("setup-proj-key-0").fill("TELE");
    await page.getByTestId("setup-step-5-submit").click();

    // Step 6: Boards & Editable Default Columns
    await expect(page.getByTestId("setup-step-6-form")).toBeVisible();
    await page.getByTestId("setup-board-name-0").fill("Mission Board");
    await expect(page.getByTestId("setup-board-0-col-name-0")).toHaveValue(
      "Backlog"
    );
    await expect(page.getByTestId("setup-board-0-col-name-1")).toHaveValue(
      "In Progress"
    );
    await page.getByTestId("setup-step-6-submit").click();

    // Step 7: Review and Finish
    await expect(page.getByTestId("setup-review-summary")).toBeVisible();
    await expect(page.getByTestId("setup-download-members-csv-btn")).toBeVisible();
    // Complete button is disabled until CSV download is acknowledged or skipped (Change 5)
    await expect(page.getByTestId("setup-complete-btn")).toBeDisabled();
    await page.getByTestId("setup-confirm-csv-downloaded-checkbox").check();
    await expect(page.getByTestId("setup-complete-btn")).toBeEnabled();
    await page.getByTestId("setup-complete-btn").click();
    await expect(page.getByTestId("setup-completed-screen")).toBeVisible();

    // Navigate to workspace dashboard
    await page.getByTestId("setup-go-dashboard-btn").click();
    await expect(page.getByTestId("left-sidebar")).toBeVisible();
    await expect(page.getByTestId("kanban-board-canvas")).toBeVisible();

    // Verify /setup is locked after completion (redirects back to /)
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("kanban-board-canvas")).toBeVisible();

    // Create a ticket on Mission Board
    await page.getByTestId("new-ticket-btn").click();
    await page
      .getByTestId("new-ticket-title-input")
      .fill("Calibrate star tracker gyroscopes");
    await page
      .getByTestId("new-ticket-desc-input")
      .fill("Ensure **sub-arcsecond** attitude control stability.");
    await page.getByTestId("new-ticket-priority-select").selectOption("urgent");
    await page.getByTestId("new-ticket-labels-input").fill("guidance, avionics");
    await page.getByTestId("create-ticket-submit").click();

    const ticketCard = page.getByTestId("ticket-card-TELE-1");
    await expect(ticketCard).toBeVisible();

    // Detail panel opens automatically on ticket creation
    const detailPanel = page.getByTestId("ticket-detail-panel");
    await expect(detailPanel).toBeVisible();
    await expect(page.getByTestId("detail-ticket-key")).toHaveText("TELE-1");

    // Add a Markdown comment
    await page
      .getByTestId("comment-input")
      .fill("Verified quaternion drift stays below **0.002 deg/hr**.");
    await page.getByTestId("comment-submit-btn").click();
    await expect(page.getByTestId("comment-item")).toContainText(
      "quaternion drift"
    );

    // Attach a GitHub PR link
    await page
      .getByTestId("add-link-input")
      .fill("https://github.com/orbital/telemetry/pull/77");
    await page.getByTestId("add-link-btn").click();
    await expect(
      page.getByTestId("ticket-link-item-orbital/telemetry#77")
    ).toBeVisible();

    // Upload a text attachment to MinIO and search for a word inside it
    const uniqueSearchWord = "hyperbolicnavigationvector";
    await page.getByTestId("attachment-file-input").setInputFiles({
      name: "flight-log.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        `Diagnostic telemetry payload containing ${uniqueSearchWord} verified.`,
        "utf8"
      ),
    });
    await expect(
      page.getByTestId("attachment-item-flight-log.txt")
    ).toBeVisible();

    // Capture desktop review screenshot
    const reviewDir = path.join(process.cwd(), ".impeccable", "review");
    fs.mkdirSync(reviewDir, { recursive: true });
    await page.screenshot({
      path: path.join(reviewDir, "desktop.png"),
      fullPage: true,
    });

    // Global search for word inside the uploaded attachment via Command Palette
    await page.getByTestId("command-palette-trigger").click();
    const searchInput = page.getByTestId("global-search-input");
    await searchInput.fill(uniqueSearchWord);
    const searchResults = page.getByTestId("search-results");
    await expect(searchResults).toBeVisible();
    await expect(page.getByTestId("search-result-TELE-1")).toBeVisible();
    await page.keyboard.press("Escape");

    // Capture mobile viewport screenshot
    await page.getByTestId("close-detail-panel").click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("ticket-card-TELE-1")).toBeVisible();
    await page.screenshot({
      path: path.join(reviewDir, "mobile.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 1440, height: 900 });

    // Client B: Log in as CSV-imported employee (member@orbital.dev), verify forced password change on first login, then verify live SSE sync
    const contextB = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const pageB = await contextB.newPage();
    await pageB.goto("/");
    await pageB.getByTestId("auth-email-input").fill("member@orbital.dev");
    await pageB.getByTestId("auth-password-input").fill("TempPass123!");
    await pageB.getByTestId("auth-submit-btn").click();

    // Forced password change screen must appear on first login
    await expect(
      pageB.getByTestId("force-password-change-form")
    ).toBeVisible();
    await pageB.getByTestId("current-password-input").fill("TempPass123!");
    await pageB.getByTestId("new-password-input").fill("NewMemberPass123!");
    await pageB.getByTestId("change-password-submit-btn").click();

    await expect(
      pageB
        .getByTestId("board-column-Backlog")
        .getByTestId("ticket-card-TELE-1")
    ).toBeVisible();
    // Live SSE pill is completely removed from UI (Change 2)
    await expect(pageB.getByTestId("sse-status")).toHaveCount(0);

    // Move TELE-1 to "In Progress" in Client A via drag-and-drop
    const inProgressCol = page.getByTestId("board-column-In Progress");
    await page.getByTestId("ticket-card-TELE-1").dragTo(inProgressCol);

    await expect(inProgressCol.getByTestId("ticket-card-TELE-1")).toBeVisible();

    // Verify Client B updates automatically via SSE without refresh
    await expect(
      pageB
        .getByTestId("board-column-In Progress")
        .getByTestId("ticket-card-TELE-1")
    ).toBeVisible({ timeout: 10000 });

    // Client B (member) does not have sidebar link and receives 403 on /dashboard/system
    await expect(pageB.getByTestId("nav-system-config")).toHaveCount(0);
    const nonAdminSysRes = await pageB.goto("/dashboard/system");
    expect(nonAdminSysRes?.status()).toBe(403);

    await contextB.close();

    // Verify System Configuration (Admin Only) & Registration Removal for Client A
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    await expect(page.getByTestId("nav-system-config")).toBeVisible();
    await page.getByTestId("nav-system-config").click();
    await expect(page).toHaveURL(/\/dashboard\/system/);
    await expect(page.getByTestId("system-config-page")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Users & Access Management" })
    ).toBeVisible();

    // Verify navigating to security section
    await page.getByTestId("subnav-security").click();
    await expect(
      page.getByRole("heading", { name: /Security & Authentication Policy/i })
    ).toBeVisible();

    // Verify back to workspace link
    await page.getByTestId("back-to-workspace").click();
    await expect(page).toHaveURL("http://localhost:3000/");

    // Verify /register is removed / returns 404
    const regResponse = await page.goto("/register");
    expect(regResponse?.status()).toBe(404);
  });
});
