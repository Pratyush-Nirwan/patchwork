import { defineConfig } from "vitest/config";
import fs from "node:fs";
import path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.test" });

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8")
) as { version?: string };

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      NEXT_PUBLIC_APP_VERSION: pkg.version || "",
      NEXT_PUBLIC_APP_BUILD_DATE: new Date().toISOString().slice(0, 10),
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

