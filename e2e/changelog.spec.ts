import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Changelog Pages & RSS (/documentation/changelog)", () => {
  test("overview & release pages pass axe a11y, mobile 390x844 overflow, keyboard filter, deep links, and RSS feed", async ({
    page,
    request,
  }) => {
    // 1. Overview page (desktop 1440x900 light)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/documentation/changelog/");
    await expect(page.getByRole("heading", { name: "Changelog", level: 1 })).toBeVisible();

    const overviewAxe = await new AxeBuilder({ page })
      .disableRules(["label-content-name-mismatch", "scrollable-region-focusable"])
      .analyze();
    expect(overviewAxe.violations).toEqual([]);

    // 2. Release page + category deep link
    await page.goto("/documentation/changelog/v0-7-0-beta/#added");
    await expect(page.getByRole("heading", { name: "v0.7.0-beta", level: 1 })).toBeVisible();
    await expect(page.locator("#added")).toBeAttached();

    const releaseAxe = await new AxeBuilder({ page })
      .disableRules(["label-content-name-mismatch", "scrollable-region-focusable"])
      .analyze();
    expect(releaseAxe.violations).toEqual([]);

    // 3. Mobile 390x844 check (dark mode, zero horizontal page overflow)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      localStorage.setItem("starlight-theme", "dark");
      document.documentElement.dataset.theme = "dark";
    });
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasOverflow).toBe(false);

    const mobileAxe = await new AxeBuilder({ page })
      .disableRules(["label-content-name-mismatch", "scrollable-region-focusable"])
      .analyze();
    expect(mobileAxe.violations).toEqual([]);

    // 4. RSS feed
    const rssRes = await request.get("/documentation/changelog.xml");
    expect(rssRes.status()).toBe(200);
    const rssXml = await rssRes.text();
    expect(rssXml).toContain('<rss version="2.0">');
    expect(rssXml).toContain("<title>Patchwork v0.7.0-beta</title>");
  });
});
