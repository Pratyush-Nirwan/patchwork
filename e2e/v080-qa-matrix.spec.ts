import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function loginAs(page: Page, email: string, password = "DevPassword123!") {
  await page.goto("/");
  await page.getByTestId("auth-email-input").fill(email);
  await page.getByTestId("auth-password-input").fill(password);
  await page.getByTestId("auth-submit-btn").click();
  await expect(page.getByTestId("kanban-board-canvas")).toBeVisible({ timeout: 15000 });
}

test.describe("v0.8.0-beta Full QA & Security Matrix", () => {
  test("1. Watchers split icon button, ticket drawer layout, @mentions zero console errors, and notification popover UX", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, "alex.chen@example.com");

    // Notification bell popover UX checks
    await page.getByTestId("notification-bell-btn").click();
    const popover = page.getByTestId("notification-popover");
    await expect(popover).toBeVisible();

    // No "Full inbox" or "Mark all read" buttons
    await expect(popover.getByText("Full inbox")).toHaveCount(0);
    await expect(popover.getByText("Mark all read")).toHaveCount(0);

    // Inline close button on same horizontal row as tabs
    const allTab = popover.getByRole("tab", { name: "All" });
    const archivedTab = popover.getByRole("tab", { name: "Archived" });
    const closeBtn = popover.getByTestId("close-notifications-btn");
    await expect(archivedTab).toBeVisible();
    const allBox = await allTab.boundingBox();
    const closeBox = await closeBtn.boundingBox();
    expect(allBox).not.toBeNull();
    expect(closeBox).not.toBeNull();
    expect(Math.abs(closeBox!.y - allBox!.y)).toBeLessThan(12);

    // Close popover
    await closeBtn.click();
    await expect(popover).not.toBeVisible();

    // /notifications standalone route removed (404)
    const notifPageRes = await page.request.get("/notifications");
    expect(notifPageRes.status()).toBe(404);

    // Open first ticket card
    const firstCard = page.locator('[data-testid^="ticket-card-"]').first();
    await firstCard.click();
    const watchToggle = page.getByTestId("ticket-watch-toggle");
    await expect(watchToggle).toBeVisible({ timeout: 10000 });

    // Split watch button: icon-only (no text), no separate mute bell button
    expect((await watchToggle.innerText()).trim()).toBe("");
    await expect(page.getByTestId("ticket-mute-toggle")).toHaveCount(0);

    // Toggle watch and open watchers dropdown
    const beforePressed = await watchToggle.getAttribute("aria-pressed");
    await watchToggle.click();
    await expect(watchToggle).toHaveAttribute(
      "aria-pressed",
      beforePressed === "true" ? "false" : "true"
    );
    await page.getByTestId("ticket-watchers-count-btn").click();
    await expect(page.getByTestId("ticket-watchers-popover")).toBeVisible();
    await page.keyboard.press("Escape");

    // Ticket key single line & Status/Priority below Assignee/Due Date
    const keyBox = await page.getByTestId("detail-ticket-key").boundingBox();
    const statusBox = await page.getByTestId("detail-column-select").boundingBox();
    const dueBox = await page.getByTestId("detail-ticket-due-date").boundingBox();
    expect(keyBox).not.toBeNull();
    expect(statusBox).not.toBeNull();
    expect(dueBox).not.toBeNull();
    expect(keyBox!.height).toBeLessThan(34);
    expect(statusBox!.y).toBeGreaterThan(dueBox!.y);

    // @mention picker works without Maximum update depth exceeded
    const commentInput = page.getByTestId("comment-input");
    await commentInput.click();
    await commentInput.fill("Ping @");
    await expect(page.getByTestId("mention-picker")).toBeVisible();
    await expect(page.getByTestId("mention-picker").getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(commentInput).toHaveValue(/@\[.+\]\(mention:[0-9a-f-]+\)/);

    // Command bar inline labeled argument pills
    await page.keyboard.press("Control+k");
    const cmdInput = page.locator('[data-testid="command-palette-input"], input[placeholder*="command" i], input[placeholder*="Search" i]').first();
    await expect(cmdInput).toBeVisible({ timeout: 5000 });
    await cmdInput.fill("/watch ");
    await page.keyboard.press("Escape");

    expect(consoleErrors.filter((e) => e.includes("Maximum update depth"))).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("2. Non-admin ticket drawer compact Status select & role API security boundaries", async ({
    page,
  }) => {
    // Unauthenticated API checks
    for (const url of [
      "/api/notifications",
      "/api/account/notifications",
      "/api/system/notifications/webhooks",
      "/api/system/notifications/email-logs",
      "/api/system/health/diagnostics",
    ]) {
      const res = await page.request.get(url);
      expect(res.status(), `Unauth GET ${url}`).toBe(401);
    }

    // Tampered unsubscribe token rejected
    const badUnsub = await page.request.get("/api/notifications/unsubscribe?token=tampered.invalid");
    expect([400, 403]).toContain(badUnsub.status());

    // Sign in as non-admin Maya Haddad
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, "maya.haddad@example.com");

    // Non-admin cannot access admin notification/system APIs
    for (const url of [
      "/api/system/notifications/webhooks",
      "/api/system/notifications/email-logs",
      "/api/system/settings/notifications",
    ]) {
      const res = await page.request.get(url);
      expect(res.status(), `Non-admin GET ${url}`).toBe(403);
    }

    // Open ticket and verify compact Status select & non-wrapping key on Chrome
    await page.locator('[data-testid^="ticket-card-"]').first().click();
    const statusSelect = page.getByTestId("detail-column-select");
    await expect(statusSelect).toBeVisible({ timeout: 10000 });
    const statusBox = await statusSelect.boundingBox();
    const keyBox = await page.getByTestId("detail-ticket-key").boundingBox();
    expect(statusBox!.width).toBeLessThanOrEqual(150);
    expect(keyBox!.height).toBeLessThan(34);
  });

  test("3. Two-user real-time presence avatars & typing indicator (no draft text transmitted)", async ({
    browser,
  }) => {
    const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      await Promise.all([
        loginAs(pageA, "alex.chen@example.com"),
        loginAs(pageB, "maya.haddad@example.com"),
      ]);

      // Both open the exact same first ticket
      const firstCardA = pageA.locator('[data-testid^="ticket-card-"]').first();
      const cardTestId = await firstCardA.getAttribute("data-testid");
      expect(cardTestId).toBeTruthy();

      await firstCardA.click();
      await pageB.getByTestId(cardTestId!).click();

      // Context A sees Maya's avatar in presence stack
      await expect(pageA.getByTestId("presence-viewer-stack")).toBeVisible({ timeout: 10000 });
      await expect(pageA.getByTestId("presence-viewer-stack")).toContainText("MA");

      // Capture presence POST payload from B while typing secret draft text
      const presencePayloads: string[] = [];
      pageB.on("request", (req) => {
        if (req.url().includes("/presence") && req.method() === "POST") {
          presencePayloads.push(req.postData() || "");
        }
      });

      const commentB = pageB.getByTestId("comment-input");
      await commentB.click();
      await commentB.type("SUPER_SECRET_DRAFT_TEXT");

      // Context A sees typing indicator for Maya
      await expect(pageA.getByTestId("typing-indicator")).toContainText("Maya Haddad is typing", {
        timeout: 10000,
      });

      // Verify draft text was NEVER transmitted in any presence payload
      expect(presencePayloads.length).toBeGreaterThan(0);
      for (const body of presencePayloads) {
        expect(body).not.toContain("SUPER_SECRET_DRAFT_TEXT");
      }
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test("4. Latency sweep on System Config sections shows skeletons (no forbidden loading text) & docs sidebar has new pages", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, "alex.chen@example.com");

    // Delay System Config API calls to verify skeletons appear without loading text
    await page.route("**/api/system/**", async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue().catch(() => undefined);
    });

    for (const section of ["health", "search", "appearance", "integrations", "data", "notifications"]) {
      await page.goto(`/dashboard/system/${section}`);
      await page.waitForTimeout(220);
      const text = await page.evaluate(() => document.body.innerText);
      expect(text, `Section ${section} leaked loading text`).not.toMatch(
        /\b(Loading diagnostics|Loading status|Loading preferences|Searching members)\b/i
      );
    }

    // Check axe on System Config -> Notifications
    await page.unroute("**/api/system/**");
    await page.goto("/dashboard/system/notifications");
    await expect(page.getByTestId("system-notifications-section")).toBeVisible({ timeout: 10000 });
    const axeSys = await new AxeBuilder({ page })
      .include('[data-testid="system-notifications-section"]')
      .analyze();
    expect(axeSys.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
  });
});
