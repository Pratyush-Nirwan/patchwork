#!/usr/bin/env node
import path from "path";
import { stopServerFromPidFile } from "./setup/server.mjs";

const projectDir = process.env.SETUP_PROJECT_DIR
  ? path.resolve(process.env.SETUP_PROJECT_DIR)
  : process.cwd();

const res = stopServerFromPidFile(projectDir);
if (res.stopped) {
  console.log(`✔ Stopped Patchwork background server (PID ${res.pid}).`);
} else {
  console.log(`ℹ ${res.reason}`);
}

