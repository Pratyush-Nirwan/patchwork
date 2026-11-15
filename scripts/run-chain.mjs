#!/usr/bin/env node
import { spawnSync } from "child_process";
import { npmBin } from "./lib/platform.mjs";

const steps = process.argv.slice(2);
if (steps.length === 0) {
  console.error("Usage: node scripts/run-chain.mjs <script1|node:path> ...");
  process.exit(1);
}

for (const step of steps) {
  let cmd;
  let args;
  if (step.startsWith("node:")) {
    cmd = process.execPath;
    args = [step.slice(5)];
  } else if (process.env.npm_execpath && process.env.npm_execpath.endsWith(".js")) {
    cmd = process.execPath;
    args = [process.env.npm_execpath, "run", step];
  } else {
    cmd = npmBin("npm");
    args = ["run", step];
  }

  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: false,
    env: process.env,
  });

  if (res.error) {
    console.error(`Failed to execute ${step}:`, res.error.message);
    process.exit(1);
  }
  if (typeof res.status === "number" && res.status !== 0) {
    process.exit(res.status);
  }
}
