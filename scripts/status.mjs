#!/usr/bin/env node
import path from "path";
import { getSupervisorStatus } from "./supervisor.mjs";

const projectDir = process.env.SETUP_PROJECT_DIR
  ? path.resolve(process.env.SETUP_PROJECT_DIR)
  : process.cwd();

const status = await getSupervisorStatus(projectDir);
console.log(`Mode       : ${status.mode}`);
console.log(`Supervisor : ${status.supervisor?.alive ? `running (PID ${status.supervisor.pid})` : "stopped"}`);
console.log(`App        : ${status.app.healthy ? `healthy (${status.app.url})` : status.app.alive ? `running (PID ${status.app.pid})` : "stopped"}`);
console.log(`PostgreSQL : ${status.postgres.reachable ? "reachable" : `unreachable (${status.postgres.error})`}`);
console.log(`MinIO      : ${status.minio.healthy ? `healthy (${status.minio.endpoint})` : `unreachable (${status.minio.endpoint})`}`);
