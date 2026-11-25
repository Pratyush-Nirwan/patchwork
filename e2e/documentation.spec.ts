import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.test" });

const DB_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test";

test.describe("Embedded Documentation (/documentation)", () => {
  test.beforeAll(async () => {
    execSync(
      `node scripts/seed.mjs --reset --size small --seed 42 --yes --database-url "${DB_URL}"`,
      { stdio: "pipe" }
    );
  });

  test("serves /documentation publicly, supports deep links, Pagefind search with zero CSP errors, theme sync, and a11y", async ({
    page,
  }) => {
    const cspErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error" && /content security policy|csp/i.test(msg.text())) {
        cspErrors.push(msg.text());
      }
    });
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    // 1. Accessible without authentication on /documentation
    const resp = await page.goto("/documentation");
    expect(resp?.status()).toBe(200);
    expect(resp?.headers()["x-robots-tag"]).toBe("noindex");
    await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Back to Patchwork" })).toHaveAttribute("href", "/");

    // Axe accessibility check on landing page (exclude upstream Starlight Search button & Expressive Code <pre> rules)
    const landingAxe = await new AxeBuilder({ page })
      .disableRules(["label-content-name-mismatch", "scrollable-region-focusable"])
      .analyze();
    expect(landingAxe.violations).toEqual([]);

    // 2. Deep link & hard reload
    await page.goto("/documentation/getting-started/quick-start/");
    await expect(page.locator("h1")).toContainText(/Quick Start/i);
    await page.reload();
    await expect(page.locator("h1")).toContainText(/Quick Start/i);

    const docAxeLight = await new AxeBuilder({ page })
      .disableRules(["label-content-name-mismatch", "scrollable-region-focusable"])
      .analyze();
    expect(docAxeLight.violations).toEqual([]);

    // 3. Pagefind search with zero CSP errors
    const searchBtn = page.locator("site-search button").first();
    await searchBtn.click();
    const searchInput = page.locator("site-search input").first();
    await searchInput.fill("Kanban");
    await expect(page.locator("site-search .pagefind-ui__result").first()).toBeVisible({
      timeout: 10000,
    });

    // 4. Theme sync from patchwork_theme
    await page.evaluate(() => {
      localStorage.setItem("patchwork_theme", "dark");
    });
    await page.goto("/documentation/user-guide/command-palette/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const docAxeDark = await new AxeBuilder({ page })
      .disableRules(["label-content-name-mismatch", "scrollable-region-focusable"])
      .analyze();
    expect(docAxeDark.violations).toEqual([]);

    // 5. Mobile viewport check (no horizontal overflow)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/documentation");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
    );
    expect(overflow).toBe(false);

    expect(cspErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("navigation links from login footer, workspace sidebar, Command Palette search, and /docs command work", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // Login footer link
    const loginDocs = page.getByTestId("login-docs-link");
    await expect(loginDocs).toBeVisible();
    await expect(loginDocs).toHaveAttribute("href", "/documentation");

    // Sign in
    await page.getByTestId("auth-email-input").fill("alex.chen@example.com");
    await page.getByTestId("auth-password-input").fill("DevPassword123!");
    await page.getByTestId("auth-submit-btn").click();
    await expect(page.getByTestId("kanban-board-canvas")).toBeVisible({ timeout: 10000 });

    // Workspace sidebar link
    const sidebarDocs = page.getByTestId("nav-documentation");
    await expect(sidebarDocs).toBeVisible();
    await expect(sidebarDocs).toHaveAttribute("href", "/documentation");

    // Command Palette normal search -> Documentation
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    const input = page.getByTestId("global-search-input");
    await input.fill("documentation");
    await expect(page.getByText("Documentation", { exact: true }).first()).toBeVisible();

    // /docs slash command -> navigates to /documentation/user-guide/command-palette
    await input.fill("/docs command-palette");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/documentation\/user-guide\/command-palette/);
  });
});
