import { test, expect } from "@playwright/test";
import pg from "pg";
import argon2 from "argon2";

const DB_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/patchwork_test";

test.describe("QA Decisions E2E (QA-10 UI & QA-15 SSE)", () => {
  const userEmail = "qa-decisions-e2e@example.com";
  const userPass = "QaDecisionsPass123!";
  let userId = "";

  test.beforeAll(async () => {
    const pool = new pg.Pool({ connectionString: DB_URL });
    try {
      const existing = await pool.query(
        `SELECT id FROM users WHERE email = $1 LIMIT 1`,
        [userEmail]
      );
      if (existing.rows.length > 0) {
        userId = existing.rows[0].id;
      } else {
        const hash = await argon2.hash(userPass);
        const uRes = await pool.query(
          `INSERT INTO users (email, name, password_hash, must_change_password, is_setup_admin)
           VALUES ($1, 'QA Decisions E2E', $2, false, true)
           RETURNING id`,
          [userEmail, hash]
        );
        userId = uRes.rows[0].id;
      }

      let orgId = (await pool.query(`SELECT id FROM orgs LIMIT 1`)).rows[0]?.id;
      if (!orgId) {
        orgId = (
          await pool.query(
            `INSERT INTO orgs (name, slug, created_by_id) VALUES ('QA Decisions Org', 'qa-dec-org', $1) RETURNING id`,
            [userId]
          )
        ).rows[0].id;
      }
      await pool.query(
        `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING`,
        [orgId, userId]
      );

      let teamId = (
        await pool.query(`SELECT id FROM teams WHERE org_id = $1 LIMIT 1`, [orgId])
      ).rows[0]?.id;
      if (!teamId) {
        teamId = (
          await pool.query(
            `INSERT INTO teams (org_id, name, slug) VALUES ($1, 'QA Team', 'qa-team') RETURNING id`,
            [orgId]
          )
        ).rows[0].id;
      }
      await pool.query(
        `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'lead') ON CONFLICT DO NOTHING`,
        [teamId, userId]
      );

      let projectId = (
        await pool.query(`SELECT id FROM projects WHERE team_id = $1 LIMIT 1`, [teamId])
      ).rows[0]?.id;
      if (!projectId) {
        projectId = (
          await pool.query(
            `INSERT INTO projects (org_id, team_id, name, key) VALUES ($1, $2, 'QA Project', 'QAD') RETURNING id`,
            [orgId, teamId]
          )
        ).rows[0].id;
      }

      let boardId = (
        await pool.query(`SELECT id FROM boards WHERE project_id = $1 LIMIT 1`, [projectId])
      ).rows[0]?.id;
      if (!boardId) {
        boardId = (
          await pool.query(
            `INSERT INTO boards (org_id, team_id, project_id, name) VALUES ($1, $2, $3, 'Main Board') RETURNING id`,
            [orgId, teamId, projectId]
          )
        ).rows[0].id;
        await pool.query(
          `INSERT INTO columns (board_id, name, position) VALUES ($1, 'Backlog', 0)`,
          [boardId]
        );
      }

      await pool.query(
        `INSERT INTO setup_state (id, admin_user_id, org_id, current_step, is_completed, completed_at)
         VALUES ('default', $1, $2, 6, true, now())
         ON CONFLICT (id) DO UPDATE SET is_completed = true`,
        [userId, orgId]
      );
    } finally {
      await pool.end();
    }
  });

  test("QA-15: shows 'Updates paused' inline in board header only after 5 SSE failures and reconnects cleanly", async ({
    page,
  }) => {
    let failSse = false;
    let sseAttempts = 0;

    await page.route("**/api/events**", async (route) => {
      if (failSse) {
        sseAttempts += 1;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.goto("/");
    await page.getByLabel(/email/i).fill(userEmail);
    await page.getByLabel(/password/i).fill(userPass);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByTestId("kanban-board-canvas")).toBeVisible({
      timeout: 15000,
    });

    // No "Live" pill anywhere and no notice during healthy operation
    await expect(page.getByText(/^Live$/i)).toHaveCount(0);
    await expect(page.getByText("Updates paused. Refresh to reconnect.")).toHaveCount(0);

    // Trigger 5+ consecutive SSE failures by switching to failing route and reloading
    failSse = true;
    await page.reload();
    await expect(page.getByTestId("kanban-board-canvas")).toBeVisible({
      timeout: 15000,
    });

    // Wait until 5 failures occur via exponential backoff (1s + 2s + 4s + 8s ~ 15s)
    await expect(page.getByTestId("board-header")).toBeVisible({
      timeout: 25000,
    });
    expect(sseAttempts).toBeGreaterThanOrEqual(5);

    const notice = page.getByTestId("board-header");
    await expect(notice).toHaveAttribute("aria-live", "polite");
    await expect(notice).toContainText("Updates paused. Refresh to reconnect.");
    await expect(page.locator("header").getByText("Updates paused. Refresh to reconnect.")).toHaveCount(0);

    // Unblock SSE, track catch-up board refetch, and click "Reconnect now"
    failSse = false;
    let boardRefetched = false;
    await page.route("**/api/boards/**", async (route) => {
      boardRefetched = true;
      await route.continue();
    });

    await page.getByTestId("sse-reconnect-now").click();

    await expect(page.getByTestId("board-header")).toHaveCount(0, {
      timeout: 10000,
    });
    expect(boardRefetched).toBe(true);
  });

  test("QA-10: handles 401 SESSION_IDLE_EXPIRED by preserving draft input, showing message once, and restoring on login", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel(/email/i).fill(userEmail);
    await page.getByLabel(/password/i).fill(userPass);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByTestId("kanban-board-canvas")).toBeVisible({
      timeout: 15000,
    });

    // Open New Ticket modal and enter a draft title
    await page.keyboard.press("c");
    const titleInput = page.getByTestId("new-ticket-title-input");
    await expect(titleInput).toBeVisible();
    await titleInput.fill("Unsaved idle draft title");

    // Simulate server returning 401 SESSION_IDLE_EXPIRED on submit
    await page.route("**/api/boards/*/tickets", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Your session expired due to inactivity",
          code: "SESSION_IDLE_EXPIRED",
        }),
      });
    });

    await page.getByRole("button", { name: /create ticket/i }).click();

    await expect(
      page.getByText("Your session expired due to inactivity")
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText("Your session expired due to inactivity")
    ).toHaveCount(1);

    // Log back in and verify draft is restored
    await page.unroute("**/api/boards/*/tickets");
    await page.getByLabel(/email/i).fill(userEmail);
    await page.getByLabel(/password/i).fill(userPass);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByTestId("kanban-board-canvas")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId("new-ticket-title-input")).toHaveValue(
      "Unsaved idle draft title",
      { timeout: 10000 }
    );
  });
});
