import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { findRepoRoot } from "./extract.mjs";

const PORT = 3106;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT_WIDTH = 1520;
const VIEWPORT_HEIGHT = 920;
const PADDING = 40;
const FINAL_WIDTH = VIEWPORT_WIDTH + PADDING * 2; // 1600px
const FINAL_HEIGHT = VIEWPORT_HEIGHT + PADDING * 2; // 1000px
const MAX_BYTES = 300 * 1024;

async function waitForUrl(url, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch {
      // Wait and retry
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function frameAndSaveWebp(sharp, pngBuffer, outPath) {
  const radius = 14;
  const roundedMask = Buffer.from(
    `<svg width="${VIEWPORT_WIDTH}" height="${VIEWPORT_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${VIEWPORT_WIDTH}" height="${VIEWPORT_HEIGHT}" rx="${radius}" ry="${radius}" fill="#fff"/>
    </svg>`
  );

  const shadowSvg = Buffer.from(
    `<svg width="${FINAL_WIDTH}" height="${FINAL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#000000" flood-opacity="0.24"/>
        </filter>
      </defs>
      <rect x="${PADDING}" y="${PADDING}" width="${VIEWPORT_WIDTH}" height="${VIEWPORT_HEIGHT}" rx="${radius}" ry="${radius}" fill="#000" filter="url(#shadow)"/>
    </svg>`
  );

  const roundedPng = await sharp(pngBuffer)
    .resize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT)
    .composite([{ input: roundedMask, blend: "dest-in" }])
    .png()
    .toBuffer();

  for (const quality of [85, 76, 68]) {
    const outBuf = await sharp(shadowSvg)
      .composite([{ input: roundedPng, left: PADDING, top: PADDING }])
      .webp({ quality, effort: 6 })
      .toBuffer();
    if (outBuf.length <= MAX_BYTES || quality === 68) {
      fs.writeFileSync(outPath, outBuf);
      return outBuf.length;
    }
  }
}

async function main() {
  const repoRoot = findRepoRoot();
  const require = createRequire(path.join(repoRoot, "website/package.json"));
  const sharp = require("sharp");

  const outDir = path.join(repoRoot, "docs/assets/readme");
  fs.mkdirSync(outDir, { recursive: true });

  const env = {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(PORT),
    APP_URL: BASE_URL,
    DATABASE_URL:
      process.env.DATABASE_URL ||
      "postgres://postgres:postgres@127.0.0.1:5432/patchwork_test",
    S3_ENDPOINT: process.env.S3_ENDPOINT || "http://127.0.0.1:9000",
    MINIO_PUBLIC_URL: process.env.MINIO_PUBLIC_URL || "http://127.0.0.1:9000",
    S3_REGION: process.env.S3_REGION || "us-east-1",
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY || "minioadmin",
    S3_SECRET_KEY: process.env.S3_SECRET_KEY || "minioadmin",
    S3_BUCKET: process.env.S3_BUCKET || "patchwork-test",
    SESSION_SECRET:
      process.env.SESSION_SECRET || "patchwork-docs-session-secret-32-bytes-min",
    CSRF_SECRET:
      process.env.CSRF_SECRET || "patchwork-docs-csrf-secret-32-bytes-minimum",
    TOKEN_ENCRYPTION_KEY:
      process.env.TOKEN_ENCRYPTION_KEY ||
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  };

  const minioProc = spawn(
    process.execPath,
    [path.join(repoRoot, "scripts/dev-minio.mjs")],
    { cwd: repoRoot, env, stdio: "ignore", shell: false }
  );

  execFileSync(
    process.execPath,
    [path.join(repoRoot, "scripts/reset-test-db.mjs")],
    { cwd: repoRoot, env, stdio: "inherit", shell: false }
  );
  execFileSync(
    process.execPath,
    [path.join(repoRoot, "scripts/seed.mjs"), "--size", "medium"],
    { cwd: repoRoot, env, stdio: "inherit", shell: false }
  );

  const nextBin = path.join(repoRoot, "node_modules/next/dist/bin/next");
  const serverProc = spawn(
    process.execPath,
    [nextBin, "dev", "-p", String(PORT)],
    { cwd: repoRoot, env, stdio: "ignore", shell: false }
  );

  try {
    await waitForUrl(`${BASE_URL}/api/health`);

    const browser = await chromium.launch();
    try {
      for (const theme of ["light", "dark"]) {
        const context = await browser.newContext({
          viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
          colorScheme: theme,
        });
        const page = await context.newPage();

        await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
        await page.fill('[data-testid="auth-email-input"]', "alex.chen@example.com");
        await page.fill('[data-testid="auth-password-input"]', "DevPassword123!");
        await page.click('[data-testid="auth-submit-btn"]');
        await page.waitForSelector('[data-testid="kanban-board-canvas"]', {
          timeout: 15000,
        });

        await page.evaluate((t) => {
          localStorage.setItem("patchwork-theme", t);
          document.documentElement.classList.toggle("dark", t === "dark");
        }, theme);
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await page.waitForTimeout(300);

        const capture = async (name) => {
          const buf = await page.screenshot({ type: "png" });
          const bytes = await frameAndSaveWebp(
            sharp,
            buf,
            path.join(outDir, `${name}-${theme}.webp`)
          );
          console.log(`Captured ${name}-${theme}.webp (${Math.round(bytes / 1024)} KB)`);
        };

        // 1. Hero Kanban board
        await capture("hero-board");

        // 2. Ticket detail panel
        const firstCard = page.locator('[data-testid^="ticket-card-"]').first();
        if (await firstCard.count()) {
          await firstCard.click();
          await page.waitForFunction(
            () => {
              const panel = document.querySelector('[data-testid="ticket-detail-panel"]');
              if (!panel) return false;
              const hasSkeleton = panel.querySelector('[data-testid*="skeleton"], .animate-pulse, [aria-busy="true"]');
              const text = (panel.textContent || "").trim();
              return !hasSkeleton && text.length > 40;
            },
            { timeout: 10000 }
          ).catch(() => {});
          await page.waitForTimeout(300);
          await capture("ticket-panel");
          await page.keyboard.press("Escape");
          await page.waitForTimeout(200);
        }

        // 3. Command palette with slash command
        await page.keyboard.press("Control+k");
        await page.waitForSelector('[data-testid="global-search-input"]', {
          timeout: 5000,
        });
        await page.fill(
          '[data-testid="global-search-input"]',
          "/new Fix SSE reconnect "
        );
        await page.waitForTimeout(250);
        await capture("command-palette");

        // 4. Full-text search inside Command Palette
        await page.fill('[data-testid="global-search-input"]', "auth");
        await page.waitForFunction(
          () => {
            const dialog = document.querySelector('[role="dialog"]');
            if (!dialog) return false;
            const hasPulse = dialog.querySelector('.animate-pulse, [aria-busy="true"]');
            const hasItems = dialog.querySelectorAll('[role="option"], [cmdk-item], button').length > 2;
            return !hasPulse && hasItems;
          },
          { timeout: 10000 }
        ).catch(() => {});
        await page.waitForTimeout(300);
        await capture("search");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);

        // 5. System Configuration
        await page.goto(`${BASE_URL}/dashboard/system`, {
          waitUntil: "networkidle",
        });
        await page.evaluate((t) => {
          localStorage.setItem("patchwork-theme", t);
          document.documentElement.classList.toggle("dark", t === "dark");
        }, theme);
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await page.waitForTimeout(300);
        await capture("system-config");

        await context.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    serverProc.kill();
    minioProc.kill();
  }

  console.log(`Saved README screenshots in ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
