import { execFileSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { isPortFree } from "./preflight.mjs";
import { parseEnvFile, writeEnvFileAtomic } from "./env.mjs";
import {
  getSystemInfo,
  killProcessTree,
  openBrowser,
} from "../lib/platform.mjs";

export { killProcessTree };
export const openDefaultBrowser = openBrowser;

export async function findNextFreePort(startPort = 3001, maxAttempts = 50) {
  for (let p = Number(startPort); p < Number(startPort) + maxAttempts; p++) {
    if (await isPortFree(p)) {
      return p;
    }
  }
  throw new Error(`No free port found starting from ${startPort}`);
}

export async function waitForServerHealth(baseUrl, timeoutMs = 60000) {
  const cleanBase = baseUrl.replace(/\/$/, "");
  const candidates = [cleanBase];
  if (cleanBase.includes("://localhost")) {
    candidates.push(cleanBase.replace("://localhost", "://127.0.0.1"));
    candidates.push(cleanBase.replace("://localhost", "://[::1]"));
  }
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const candidate of candidates) {
      for (const route of ["/api/health", "/api/setup/status"]) {
        try {
          const res = await fetch(`${candidate}${route}`, {
            signal: AbortSignal.timeout(1500),
          });
          if (res.status === 200) {
            return true;
          }
        } catch {
          // Keep polling until deadline
        }
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

export function stopServerFromPidFile(projectDir = process.cwd()) {
  const pidPath = path.join(projectDir, ".patchwork.pid");
  if (!fs.existsSync(pidPath)) {
    return { stopped: false, reason: "No .patchwork.pid file found" };
  }
  const rawPid = fs.readFileSync(pidPath, "utf8").trim();
  const pid = Number(rawPid);
  if (Number.isInteger(pid) && pid > 0) {
    killProcessTree(pid);
  }
  try {
    fs.unlinkSync(pidPath);
  } catch {
    // Ignore
  }
  return { stopped: true, pid };
}

export async function resolveAndPreparePort({
  desiredPort = 3000,
  envPath,
  interactive = false,
  confirmPortChange,
  outputStream = process.stdout,
}) {
  const portNum = Number(desiredPort);
  if (await isPortFree(portNum)) {
    return { port: portNum, changed: false };
  }

  const nextPort = await findNextFreePort(portNum + 1);
  outputStream.write(
    `⚠ Port ${portNum} is already in use. Next available port is ${nextPort}.\n`
  );

  if (interactive && typeof confirmPortChange === "function") {
    const allowed = await confirmPortChange(portNum, nextPort);
    if (!allowed) {
      throw new Error(
        `Port ${portNum} is already in use. Stop the conflicting process or re-run setup.`
      );
    }
  }

  if (envPath && fs.existsSync(envPath)) {
    const parsed = parseEnvFile(envPath);
    const updatedUrl = (parsed.values.APP_URL || `http://localhost:${portNum}`).replace(
      `:${portNum}`,
      `:${nextPort}`
    );
    const nextValues = {
      ...parsed.values,
      PORT: String(nextPort),
      APP_URL: updatedUrl.includes(`:${nextPort}`)
        ? updatedUrl
        : `http://localhost:${nextPort}`,
    };
    writeEnvFileAtomic(envPath, nextValues, { backup: true });
  }

  return { port: nextPort, changed: true };
}

export async function runBuildWithSpinner({
  appRootDir = process.cwd(),
  skipIfAlreadyBuilt = false,
  outputStream = process.stdout,
}) {
  const buildIdPath = path.join(appRootDir, ".next", "BUILD_ID");
  const docsIndexPath = path.join(appRootDir, "documentation-dist", "index.html");
  if (skipIfAlreadyBuilt && fs.existsSync(buildIdPath) && fs.existsSync(docsIndexPath)) {
    outputStream.write("✔ Production build ready.\n");
    return;
  }

  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let idx = 0;
  outputStream.write(`${frames[0]} Building Patchwork production bundle...`);
  const timer = setInterval(() => {
    idx = (idx + 1) % frames.length;
    if (outputStream.isTTY) {
      outputStream.write(`\r${frames[idx]} Building Patchwork production bundle...`);
    }
  }, 120);

  try {
    const astroBin = path.join(appRootDir, "docs-site", "node_modules", "astro", "astro.js");
    const copyDistScript = path.join(appRootDir, "scripts", "docs", "copy-dist.mjs");
    if (fs.existsSync(astroBin) && fs.existsSync(copyDistScript)) {
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [astroBin, "build"], {
          cwd: path.join(appRootDir, "docs-site"),
          env: { ...process.env, NODE_ENV: "production", DOCS_BASE: "/documentation" },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        const errLines = [];
        child.stderr.on("data", (d) => errLines.push(d.toString()));
        child.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`docs build exited with ${code}:\n${errLines.join("")}`));
        });
      });
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [copyDistScript], {
          cwd: appRootDir,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        const errLines = [];
        child.stderr.on("data", (d) => errLines.push(d.toString()));
        child.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`copy-dist exited with ${code}:\n${errLines.join("")}`));
        });
      });
    }

    const nextBin = path.join(
      appRootDir,
      "node_modules",
      "next",
      "dist",
      "bin",
      "next"
    );
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [nextBin, "build"], {
        cwd: appRootDir,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const errLines = [];
      child.stderr.on("data", (d) => errLines.push(d.toString()));
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`npm run build exited with ${code}:\n${errLines.join("")}`));
      });
    });
    clearInterval(timer);
    if (outputStream.isTTY) {
      outputStream.write("\r\x1b[2K✔ Production build complete.\n");
    } else {
      outputStream.write(" ✔ Done.\n");
    }
  } catch (err) {
    clearInterval(timer);
    outputStream.write("\n");
    throw err;
  }
}

export async function startApplicationServer({
  projectDir = process.cwd(),
  appRootDir = process.cwd(),
  envPath,
  desiredPort = 3000,
  devMode = false,
  noStart = false,
  noOpen = false,
  nonInteractive = false,
  interactive = false,
  confirmPortChange,
  confirmLinuxSystemd,
  healthTimeoutMs = 60000,
  skipBuildIfAlreadyBuilt = false,
  outputStream = process.stdout,
}) {
  const manualCmd = devMode ? "npm run dev" : "npm run build && npm run start";

  if (noStart) {
    outputStream.write(
      `ℹ Server start skipped (--no-start). Start manually with: ${manualCmd}\n`
    );
    return {
      started: false,
      skipped: true,
      port: Number(desiredPort),
      url: `http://localhost:${desiredPort}/setup`,
    };
  }

  // Linux systemd path when available and confirmed
  const sys = getSystemInfo();
  if (sys.hasSystemd && !devMode && interactive && typeof confirmLinuxSystemd === "function") {
    const useSystemd = await confirmLinuxSystemd();
    if (useSystemd) {
      await runBuildWithSpinner({
        appRootDir,
        skipIfAlreadyBuilt: skipBuildIfAlreadyBuilt,
        outputStream,
      });
      const serviceSrc = path.join(appRootDir, "deploy", "patchwork.service");
      const runSystemCmd = (cmd, args) => {
        if (sys.isRoot) {
          execFileSync(cmd, args, { stdio: "inherit", shell: false });
        } else {
          outputStream.write(`ℹ Elevating with sudo to run: ${cmd} ${args.join(" ")}\n`);
          execFileSync("sudo", [cmd, ...args], { stdio: "inherit", shell: false });
        }
      };
      runSystemCmd("cp", [serviceSrc, "/etc/systemd/system/patchwork.service"]);
      runSystemCmd("systemctl", ["daemon-reload"]);
      runSystemCmd("systemctl", ["enable", "--now", "patchwork.service"]);
      const setupUrl = `http://localhost:${desiredPort}/setup`;
      outputStream.write(`✔ Patchwork is running → ${setupUrl}\n`);
      return {
        started: true,
        mode: "systemd",
        port: Number(desiredPort),
        url: setupUrl,
      };
    }
  } else if (sys.isWindows && !devMode) {
    outputStream.write(
      "ℹ Windows detected: systemd is Linux-only. Start Patchwork directly with `npm run start`.\n"
    );
  }

  const resolvedPortInfo = await resolveAndPreparePort({
    desiredPort,
    envPath,
    interactive,
    confirmPortChange,
    outputStream,
  });
  const activePort = resolvedPortInfo.port;
  const baseUrl = `http://localhost:${activePort}`;
  const setupUrl = `${baseUrl}/setup`;

  if (!devMode) {
    await runBuildWithSpinner({
      appRootDir,
      skipIfAlreadyBuilt: skipBuildIfAlreadyBuilt,
      outputStream,
    });
  }

  const parsedEnv = envPath ? parseEnvFile(envPath).values : {};
  const nextBin = path.join(
    appRootDir,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next"
  );
  const subcommand = devMode ? "dev" : "start";

  const serverLogPath = path.join(projectDir, ".patchwork-server.log");
  let logFd = null;
  if (nonInteractive) {
    logFd = fs.openSync(serverLogPath, "w");
  }

  const child = spawn(
    process.execPath,
    [nextBin, subcommand, "-p", String(activePort)],
    {
      cwd: appRootDir,
      env: {
        ...process.env,
        ...parsedEnv,
        PORT: String(activePort),
        APP_URL: baseUrl,
        NODE_ENV: devMode ? "development" : "production",
      },
      detached: nonInteractive,
      stdio: nonInteractive ? ["ignore", logFd, logFd] : ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }
  );

  if (logFd !== null) {
    try {
      fs.closeSync(logFd);
    } catch {
      // Ignore
    }
  }

  const recentLines = [];
  let streamingForeground = false;

  const recordOutput = (chunk) => {
    const text = chunk.toString("utf8");
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    for (const line of lines) {
      recentLines.push(line);
      if (recentLines.length > 20) {
        recentLines.shift();
      }
    }
    if (streamingForeground) {
      outputStream.write(text);
    }
  };

  if (child.stdout) {
    child.stdout.on("data", recordOutput);
  }
  if (child.stderr) {
    child.stderr.on("data", recordOutput);
  }

  const pidPath = path.join(projectDir, ".patchwork.pid");
  if (child.pid) {
    fs.writeFileSync(pidPath, `${child.pid}\n`, "utf8");
  }

  const healthy = await waitForServerHealth(baseUrl, healthTimeoutMs);
  if (!healthy) {
    killProcessTree(child.pid);
    if (fs.existsSync(pidPath)) {
      try {
        fs.unlinkSync(pidPath);
      } catch {
        // Ignore
      }
    }
    if (nonInteractive && fs.existsSync(serverLogPath)) {
      const fileLines = fs
        .readFileSync(serverLogPath, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);
      recentLines.push(...fileLines.slice(-20));
    }
    const last20 = recentLines.slice(-20).join("\n");
    const errMsg = [
      `✖ Server failed to pass health check within ${Math.round(healthTimeoutMs / 1000)}s.`,
      `Last 20 lines of server output:`,
      last20 || "(no output captured)",
      `Run manually with: ${manualCmd}`,
    ].join("\n");
    outputStream.write(`${errMsg}\n`);
    throw new Error(errMsg);
  }

  outputStream.write(`✔ Patchwork is running → ${setupUrl}\n`);

  if (!noOpen && !nonInteractive) {
    openDefaultBrowser(setupUrl);
  }

  if (nonInteractive) {
    child.unref();
    return {
      started: true,
      mode: "background",
      pid: child.pid,
      pidPath,
      port: activePort,
      url: setupUrl,
    };
  }

  // Foreground streaming mode: stream output below one-line status header until Ctrl+C
  outputStream.write(
    `─── Patchwork server output (${subcommand} on port ${activePort}, press Ctrl+C to stop) ───\n`
  );
  streamingForeground = true;

  return new Promise((resolve) => {
    const stopAndExit = () => {
      streamingForeground = false;
      killProcessTree(child.pid);
      if (fs.existsSync(pidPath)) {
        try {
          fs.unlinkSync(pidPath);
        } catch {
          // Ignore
        }
      }
      outputStream.write("\n✔ Patchwork server stopped.\n");
      resolve({
        started: true,
        stoppedCleanly: true,
        mode: "foreground",
        pid: child.pid,
        port: activePort,
        url: setupUrl,
      });
    };

    process.once("SIGINT", stopAndExit);
    process.once("SIGTERM", stopAndExit);
    child.once("exit", () => {
      process.removeListener("SIGINT", stopAndExit);
      process.removeListener("SIGTERM", stopAndExit);
      resolve({
        started: true,
        stoppedCleanly: true,
        mode: "foreground",
        pid: child.pid,
        port: activePort,
        url: setupUrl,
      });
    });
  });
}

