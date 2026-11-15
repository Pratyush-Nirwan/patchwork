import { test, expect } from "@playwright/test";
import pg from "pg";
import argon2 from "argon2";

const DB_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/patchwork_test";

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "390x844", width: 390, height: 844 },
];

test.describe("QA Accessibility, Security & Responsive Suite", () => {
  test.beforeAll(async () => {
    const pool = new pg.Pool({ connectionString: DB_URL });
    try {
      const existing = await pool.query(
        `SELECT id FROM users WHERE email = 'qa-e2e-admin@example.com' LIMIT 1`
      );
      if (existing.rows.length === 0) {
        const hash = await argon2.hash("QaAdminPass123!");
        const userRes = await pool.query(
          `INSERT INTO users (email, name, password_hash, must_change_password, is_setup_admin)
           VALUES ('qa-e2e-admin@example.com', 'QA E2E Admin', $1, false, true)
           RETURNING id`,
          [hash]
        );
        const userId = userRes.rows[0].id;

        const orgRes = await pool.query(
          `SELECT id FROM orgs LIMIT 1`
        );
        let orgId = orgRes.rows[0]?.id;
        if (!orgId) {
          const createdOrg = await pool.query(
            `INSERT INTO orgs (name, slug, created_by_id) VALUES ('QA Org', 'qa-org', $1) RETURNING id`,
            [userId]
          );
          orgId = createdOrg.rows[0].id;
        }
        await pool.query(
          `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING`,
          [orgId, userId]
        );
        await pool.query(
          `INSERT INTO setup_state (id, admin_user_id, org_id, current_step, is_completed, completed_at)
           VALUES ('default', $1, $2, 6, true, now())
           ON CONFLICT (id) DO UPDATE SET is_completed = true`,
          [userId, orgId]
        );
      }
    } finally {
      await pool.end();
    }
  });

  test("enforces security headers and redirects unauthenticated /dashboard/system", async ({
    request,
  }) => {
    const homeRes = await request.get("/");
    expect(homeRes.headers()["x-content-type-options"]).toBe("nosniff");
    expect(homeRes.headers()["x-frame-options"]).toBe("DENY");
    expect(homeRes.headers()["referrer-policy"]).toBe(
      "strict-origin-when-cross-origin"
    );

    const sysRes = await request.get("/dashboard/system", { maxRedirects: 0 });
    expect([302, 307]).toContain(sysRes.status());
  });

  test("verifies responsive layout, dark mode sync, a11y labels, and ticket select text across viewports", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("patchwork_theme", "dark");
    });

    // Mobile login: sign-in form above the fold
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "networkidle" });
    const emailBox = await page
      .locator('[data-testid="auth-email-input"]')
      .boundingBox();
    expect(emailBox).not.toBeNull();
    expect(emailBox!.y).toBeLessThan(400);

    // Sign in
    await page.fill('[data-testid="auth-email-input"]', "qa-e2e-admin@example.com");
    await page.fill('input[type="password"]', "QaAdminPass123!");
    await page.click('button[type="submit"]');
    await page.waitForSelector('button[aria-label="Toggle Sidebar"]', {
      timeout: 15000,
    });

    // Check System Configuration in dark mode & all viewports
    await page.goto("/dashboard/system", { waitUntil: "networkidle" });
    const hasDarkClass = await page.evaluate(() =>
      document.documentElement.classList.contains("dark")
    );
    expect(hasDarkClass).toBe(true);

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(100);
      const metrics = await page.evaluate(() => {
        const overflow =
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth;
        const unlabeled = Array.from(document.querySelectorAll("button")).filter(
          (b) => {
            const r = b.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return false;
            const txt = (b.textContent || "").trim();
            const aria =
              b.getAttribute("aria-label") ||
              b.getAttribute("title") ||
              "";
            return !txt && !aria;
          }
        );
        const hasLivePill = Array.from(
          document.querySelectorAll("span, div, button")
        ).some((el) => (el.textContent || "").trim() === "Live");
        return { overflow, unlabeledCount: unlabeled.length, hasLivePill };
      });
      expect(metrics.overflow).toBeLessThanOrEqual(1);
      expect(metrics.unlabeledCount).toBe(0);
      expect(metrics.hasLivePill).toBe(false);
    }

    // Back to workspace: check no duplicate option text like "BacklogBacklog"
    await page.goto("/", { waitUntil: "networkidle" });
    await page.setViewportSize({ width: 1440, height: 900 });
    const optionTexts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("select option")).map((o) =>
        (o.textContent || "").trim()
      )
    );
    for (const text of optionTexts) {
      expect(text).not.toMatch(/^(.+)\1$/);
    }
  });
});
