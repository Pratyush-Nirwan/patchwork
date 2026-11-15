import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { findRepoRoot } from "./extract.mjs";

const PORT = 3105;
const BASE_URL = `http://127.0.0.1:${PORT}`;

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

async function main() {
  const repoRoot = findRepoRoot();
  const outDir = path.join(repoRoot, "docs-site/src/assets/screenshots");
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

  // Start MinIO
  const minioProc = spawn(
    process.execPath,
    [path.join(repoRoot, "scripts/dev-minio.mjs")],
    { cwd: repoRoot, env, stdio: "ignore", shell: false }
  );

  // Start Next.js dev server on isolated port
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
          viewport: { width: 1280, height: 800 },
          colorScheme: theme,
        });
        const page = await context.newPage();

        // 1. Login screen
        await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
        await page.evaluate((t) => {
          localStorage.setItem("patchwork-theme", t);
          document.documentElement.classList.toggle("dark", t === "dark");
        }, theme);
        await page.waitForTimeout(150);
        await page.screenshot({
          path: path.join(outDir, `login-${theme}.png`),
        });

        // Sign in as seeded admin (example.com placeholder domain)
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
        await page.waitForTimeout(250);

        // 2. Board view
        await page.screenshot({
          path: path.join(outDir, `board-${theme}.png`),
        });

        // 3. Ticket detail panel
        const firstCard = page.locator('[data-testid^="ticket-card-"]').first();
        if (await firstCard.count()) {
          await firstCard.click();
          await page.waitForTimeout(300);
          await page.screenshot({
            path: path.join(outDir, `ticket-panel-${theme}.png`),
          });
          await page.keyboard.press("Escape");
          await page.waitForTimeout(150);
        }

        // 4. Command palette
        await page.keyboard.press("Control+k");
        await page.waitForSelector('[data-testid="global-search-input"]', {
          timeout: 5000,
        });
        await page.fill(
          '[data-testid="global-search-input"]',
          "/new Fix SSE reconnect "
        );
        await page.waitForTimeout(200);
        await page.screenshot({
          path: path.join(outDir, `command-palette-${theme}.png`),
        });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(150);

        // 5. System Configuration
        await page.goto(`${BASE_URL}/dashboard/system`, {
          waitUntil: "networkidle",
        });
        await page.evaluate((t) => {
          localStorage.setItem("patchwork-theme", t);
          document.documentElement.classList.toggle("dark", t === "dark");
        }, theme);
        await page.waitForTimeout(250);
        await page.screenshot({
          path: path.join(outDir, `system-config-${theme}.png`),
        });

        // 6. Roles & Permissions section
        await page.goto(`${BASE_URL}/dashboard/system/roles-permissions`, {
          waitUntil: "networkidle",
        });
        await page.evaluate((t) => {
          localStorage.setItem("patchwork-theme", t);
          document.documentElement.classList.toggle("dark", t === "dark");
        }, theme);
        await page.waitForTimeout(250);
        await page.screenshot({
          path: path.join(outDir, `roles-table-${theme}.png`),
        });

        await context.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    serverProc.kill();
    minioProc.kill();
  }

  console.log(`Captured documentation screenshots in ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
