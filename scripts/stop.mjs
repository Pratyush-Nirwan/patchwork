#!/usr/bin/env node
import path from "path";
import { stopSupervisorFromPidFile } from "./supervisor.mjs";

const projectDir = process.env.SETUP_PROJECT_DIR
  ? path.resolve(process.env.SETUP_PROJECT_DIR)
  : process.cwd();

const res = await stopSupervisorFromPidFile(projectDir);
if (res.stopped) {
  console.log(`✔ ${res.reason}`);
} else {
  console.log(`ℹ ${res.reason}`);
}
