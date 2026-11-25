import { defineConfig, devices } from "@playwright/test";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.test" });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: process.env.PW_USE_DEV === "1" ? "npm run dev" : "npm run start",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
    timeout: 60000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test",
      S3_ENDPOINT: process.env.S3_ENDPOINT || "http://127.0.0.1:9000",
      S3_REGION: process.env.S3_REGION || "us-east-1",
      S3_ACCESS_KEY: process.env.S3_ACCESS_KEY || "minioadmin",
      S3_SECRET_KEY: process.env.S3_SECRET_KEY || "minioadmin",
      S3_BUCKET: process.env.S3_BUCKET || "patchwork-test",
      SESSION_SECRET: process.env.SESSION_SECRET || "patchwork-test-secret-key-32-bytes-minimum-len",
      TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      PATCHWORK_ENABLE_DEV_GALLERY: process.env.PATCHWORK_ENABLE_DEV_GALLERY || "1",
    },
  },
});

