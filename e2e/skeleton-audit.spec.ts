import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

function linToSrgb(c: number): number {
  const clamped = Math.max(0, Math.min(1, c));
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

function parseRgb(str: string): [number, number, number] {
  const rgbMatch = str.match(/rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/i);
  if (rgbMatch) {
    return [Number(rgbMatch[1]) / 255, Number(rgbMatch[2]) / 255, Number(rgbMatch[3]) / 255];
  }
  const oklabMatch = str.match(/oklab\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/i);
  if (oklabMatch) {
    const L = Number(oklabMatch[1]);
    const a = Number(oklabMatch[2]);
    const b = Number(oklabMatch[3]);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ ** 3;
    const m = m_ ** 3;
    const s = s_ ** 3;
    return [
      linToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      linToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      linToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ];
  }
  throw new Error(`Unable to parse color: ${str}`);
}

function srgbToLin(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function oklchLightness([r, g, b]: [number, number, number]): number {
  const lr = srgbToLin(r);
  const lg = srgbToLin(g);
  const lb = srgbToLin(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

const SURFACES = [
  "page",
  "surface",
  "rail",
  "card",
  "panel",
  "popover",
  "table-header",
  "table-row",
  "table-stripe",
  "table-hover",
  "table-selected",
  "input",
  "toast",
  "tooltip",
  "command",
  "code",
  "accent",
  "success",
  "warning",
  "destructive",
  "info",
  "chip",
];

test.describe("Skeleton color tokens, accessibility, and latency guard", () => {
  test("dev gallery skeletons meet OKLCH contrast (1.08-1.5) & lightness (0.03-0.10) on all surfaces in light & dark", async ({
    page,
  }) => {
    await page.goto("/dev/skeletons");
    await expect(page.getByTestId("skeleton-gallery")).toBeVisible();

    for (const theme of ["light", "dark"] as const) {
      if (theme === "dark") {
        await page.getByTestId("gallery-toggle-theme").click();
      }

      for (const variant of SURFACES) {
        const colors = await page.evaluate((v) => {
          const surfaceEl = document.querySelector(`[data-testid="gallery-surface-${v}"]`);
          const skEl = document.querySelector(`[data-testid="gallery-sk-${v}"]`);
          if (!surfaceEl || !skEl) return null;
          return {
            surfaceBg: getComputedStyle(surfaceEl).backgroundColor,
            skBg: getComputedStyle(skEl).backgroundColor,
          };
        }, variant);

        expect(colors, `Missing gallery surface ${variant}`).not.toBeNull();
        const surfRgb = parseRgb(colors!.surfaceBg);
        const skRgb = parseRgb(colors!.skBg);
        const cr = contrastRatio(surfRgb, skRgb);
        const dL = Math.abs(oklchLightness(skRgb) - oklchLightness(surfRgb));

        expect(cr, `${theme}:${variant} CR=${cr.toFixed(2)}`).toBeGreaterThanOrEqual(1.08);
        expect(cr, `${theme}:${variant} CR=${cr.toFixed(2)}`).toBeLessThanOrEqual(1.5);
        expect(dL, `${theme}:${variant} dL=${dL.toFixed(3)}`).toBeGreaterThanOrEqual(0.03);
        expect(dL, `${theme}:${variant} dL=${dL.toFixed(3)}`).toBeLessThanOrEqual(0.1);

        // Direction check: darker on light surfaces, lighter on dark surfaces (and rail is always dark)
        const isDarkSurface = theme === "dark" || variant === "rail";
        if (isDarkSurface) {
          expect(oklchLightness(skRgb)).toBeGreaterThan(oklchLightness(surfRgb));
        } else {
          expect(oklchLightness(skRgb)).toBeLessThan(oklchLightness(surfRgb));
        }
      }

      // Nested surfaces compute distinct derived bases
      const nested = await page.evaluate(() => ({
        panel: getComputedStyle(document.querySelector('[data-testid="gallery-nested-sk-panel"]')!).backgroundColor,
        card: getComputedStyle(document.querySelector('[data-testid="gallery-nested-sk-card"]')!).backgroundColor,
        chip: getComputedStyle(document.querySelector('[data-testid="gallery-nested-sk-chip"]')!).backgroundColor,
      }));
      expect(nested.panel).not.toBe(nested.card);
      expect(nested.card).not.toBe(nested.chip);

      // Axe accessibility check with skeletons visible
      const axe = await new AxeBuilder({ page }).analyze();
      expect(axe.violations).toEqual([]);
    }
  });

  test("reduced motion disables skeleton shimmer", async ({ page }) => {
    await page.goto("/dev/skeletons");
    await page.getByTestId("gallery-toggle-motion").click();
    const afterDisplay = await page.evaluate(() => {
      const sk = document.querySelector('[data-testid="gallery-sk-surface"]')!;
      return getComputedStyle(sk, "::after").display;
    });
    expect(afterDisplay).toBe("none");
  });

  test("hard load in dark mode applies .dark before first paint (no light skeleton flash)", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("patchwork_theme", "dark");
    });
    await page.goto("/dev/skeletons");
    const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    expect(isDark).toBe(true);
  });

  test("latency harness: no forbidden loading text or spinners appear while API requests are delayed", async ({
    page,
  }) => {
    await page.route("**/api/workspace**", async (route) => {
      await new Promise((r) => setTimeout(r, 900));
      await route.continue();
    });

    await page.goto("/");
    // While workspace is loading, skeleton should appear and zero forbidden text should be visible
    await page.waitForTimeout(250);
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText).not.toMatch(/\b(loading|initiali[sz]ing|please wait|fetching|checking|connecting|preparing|syncing)\b/i);
  });
});
