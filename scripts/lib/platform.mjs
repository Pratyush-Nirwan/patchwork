import { execFileSync, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

function normalizeArch(arch) {
  if (arch === "arm64" || arch === "aarch64") return "arm64";
  return "x64";
}

export function createPlatformHelper({
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const isWindows = platform === "win32";
  const isLinux = platform === "linux";
  const isMac = platform === "darwin";
  const normalizedArch = normalizeArch(arch);

  function npmBin(name = "npm") {
    if (isWindows && (name === "npm" || name === "npx")) {
      return `${name}.cmd`;
    }
    return name;
  }

  function hasCommand(cmd) {
    const pathEnv = process.env.PATH || "";
    const dirs = pathEnv.split(path.delimiter).filter(Boolean);
    const exts = isWindows
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .filter(Boolean)
      : [""];

    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = path.join(dir, cmd.endsWith(ext) ? cmd : `${cmd}${ext}`);
        try {
          fs.accessSync(candidate, isWindows ? fs.constants.F_OK : fs.constants.X_OK);
          return candidate;
        } catch {
          // continue searching
        }
      }
    }
    return null;
  }

  function getMinioDownloadInfo() {
    let osSlug = "linux";
    if (isWindows) osSlug = "windows";
    else if (isMac) osSlug = "darwin";

    const archSlug = normalizedArch === "arm64" ? "arm64" : "amd64";
    const file = isWindows ? "minio.exe" : "minio";
    const downloadUrl = `https://dl.min.io/server/minio/release/${osSlug}-${archSlug}/${file}`;
    const installCommand = isWindows
      ? `New-Item -ItemType Directory -Force -Path .\\bin; Invoke-WebRequest -Uri "${downloadUrl}" -OutFile .\\bin\\minio.exe`
      : `mkdir -p ./bin && curl -fsSL "${downloadUrl}" -o ./bin/minio && chmod +x ./bin/minio`;
    const altInstallCommand = isWindows
      ? installCommand
      : `mkdir -p ./bin && wget -q "${downloadUrl}" -O ./bin/minio && chmod +x ./bin/minio`;

    return { downloadUrl, installCommand, altInstallCommand };
  }

  function binPath(name, { projectDir = process.cwd() } = {}) {
    const file = isWindows ? `${name}.exe` : name;
    const localCandidate = path.join(projectDir, "bin", file);
    const systemCandidate = !isWindows ? path.posix.join("/usr", "local", "bin", name) : null;

    let resolved = localCandidate;
    let exists = fs.existsSync(localCandidate);
    if (!exists && systemCandidate && fs.existsSync(systemCandidate)) {
      resolved = systemCandidate;
      exists = true;
    }

    let executable = false;
    if (exists) {
      if (isWindows) {
        executable = true;
      } else {
        try {
          fs.accessSync(resolved, fs.constants.X_OK);
          executable = true;
        } catch {
          executable = false;
        }
      }
    }

    const downloadInfo =
      name === "minio"
        ? getMinioDownloadInfo()
        : { downloadUrl: "", installCommand: "", altInstallCommand: "" };

    let hint = "";
    if (!exists) {
      hint =
        name === "minio"
          ? `Missing MinIO binary at ${localCandidate}. Download for ${platform}/${normalizedArch}:\n  ${downloadInfo.installCommand}`
          : `Missing binary ${file} at ${localCandidate}.`;
    } else if (!executable && !isWindows) {
      hint = `Binary ${resolved} is not executable. Run: chmod +x "${resolved}"`;
    }

    return {
      name,
      file,
      path: resolved,
      expectedPath: localCandidate,
      exists,
      executable,
      hint,
      ...downloadInfo,
    };
  }

  function findPostgresTools() {
    const tools = ["psql", "pg_dump", "pg_restore", "createdb"];
    const searchDirs = [];

    if (isWindows) {
      const pf = process.env.ProgramFiles || path.join("C:", "Program Files");
      const pgRoot = path.join(pf, "PostgreSQL");
      if (fs.existsSync(pgRoot)) {
        try {
          const versions = fs
            .readdirSync(pgRoot, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
            .sort((a, b) => Number(b) - Number(a));
          for (const v of versions) {
            searchDirs.push(path.join(pgRoot, v, "bin"));
          }
        } catch {
          // ignore unreadable dir
        }
      }
    } else if (isLinux) {
      const pgRoot = path.posix.join("/usr", "lib", "postgresql");
      if (fs.existsSync(pgRoot)) {
        try {
          const versions = fs
            .readdirSync(pgRoot, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
            .sort((a, b) => Number(b) - Number(a));
          for (const v of versions) {
            searchDirs.push(path.posix.join(pgRoot, v, "bin"));
          }
        } catch {
          // ignore
        }
      }
    }

    const resolved = {};
    for (const tool of tools) {
      let found = hasCommand(tool);
      if (!found) {
        const fileName = isWindows ? `${tool}.exe` : tool;
        for (const dir of searchDirs) {
          const candidate = path.join(dir, fileName);
          if (fs.existsSync(candidate)) {
            found = candidate;
            break;
          }
        }
      }
      resolved[tool] = found;
    }
    return resolved;
  }

  function setSecureFileMode(filePath) {
    if (!fs.existsSync(filePath)) {
      return {
        ok: false,
        enforced: false,
        mode: "missing",
        detail: `File not found: ${filePath}`,
      };
    }

    if (!isWindows) {
      try {
        fs.chmodSync(filePath, 0o600);
        const mode = fs.statSync(filePath).mode & 0o777;
        const enforced = mode === 0o600;
        return {
          ok: enforced,
          enforced,
          mode: `0${mode.toString(8)}`,
          detail: enforced
            ? "POSIX mode 0600 enforced and verified"
            : `Expected 0600, got 0${mode.toString(8)}`,
        };
      } catch (err) {
        return {
          ok: false,
          enforced: false,
          mode: "error",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // Windows: apply user-only ACL with icacls and verify
    try {
      const username = process.env.USERNAME || os.userInfo().username;
      execFileSync(
        "icacls",
        [filePath, "/inheritance:r", "/grant:r", `${username}:(R,W)`],
        { stdio: "pipe", shell: false }
      );
      const out = execFileSync("icacls", [filePath], {
        encoding: "utf8",
        stdio: "pipe",
        shell: false,
      });
      const hasUser = out.toLowerCase().includes(username.toLowerCase());
      const hasUsersGroup = /BUILTIN\\Users/i.test(out);
      const enforced = hasUser && !hasUsersGroup;
      return {
        ok: enforced,
        enforced,
        mode: enforced ? "icacls-user-rw" : "icacls-partial",
        detail: enforced
          ? `Windows ACL restricted to ${username} (R,W) and verified`
          : `Windows ACL verification inconclusive for ${username}`,
      };
    } catch (err) {
      return {
        ok: false,
        enforced: false,
        mode: "unrestricted",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  function killProcessTree(pid) {
    const numPid = Number(pid);
    if (!Number.isInteger(numPid) || numPid <= 0) return false;

    if (isWindows) {
      try {
        execFileSync("taskkill", ["/PID", String(numPid), "/T", "/F"], {
          stdio: "ignore",
          shell: false,
        });
        return true;
      } catch {
        return false;
      }
    }

    // POSIX: try process group first, then direct PID, escalating SIGTERM -> SIGKILL
    let signaled = false;
    for (const target of [-numPid, numPid]) {
      try {
        process.kill(target, "SIGTERM");
        signaled = true;
      } catch {
        // ignore ESRCH
      }
    }
    if (!signaled) return false;

    try {
      process.kill(numPid, 0);
      // Still alive: escalate to SIGKILL
      for (const target of [-numPid, numPid]) {
        try {
          process.kill(target, "SIGKILL");
        } catch {
          // ignore
        }
      }
    } catch {
      // already exited
    }
    return true;
  }

  function openBrowser(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
      }
      if (isWindows) {
        const child = spawn("cmd.exe", ["/c", "start", "", parsed.toString()], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
          shell: false,
        });
        child.unref();
      } else if (isMac) {
        const child = spawn("open", [parsed.toString()], {
          detached: true,
          stdio: "ignore",
          shell: false,
        });
        child.unref();
      } else {
        const child = spawn("xdg-open", [parsed.toString()], {
          detached: true,
          stdio: "ignore",
          shell: false,
        });
        child.unref();
      }
      return true;
    } catch {
      return false;
    }
  }

  function getSystemInfo() {
    const isRoot =
      !isWindows && typeof process.getuid === "function" && process.getuid() === 0;
    const hasSystemd = isLinux && fs.existsSync("/run/systemd/system");
    const hasUfw = isLinux && Boolean(hasCommand("ufw"));
    return {
      platform,
      arch: normalizedArch,
      release: os.release(),
      isWindows,
      isLinux,
      isMac,
      isRoot,
      hasSystemd,
      hasUfw,
    };
  }

  return {
    platform,
    arch: normalizedArch,
    isWindows,
    isLinux,
    isMac,
    npmBin,
    hasCommand,
    binPath,
    findPostgresTools,
    setSecureFileMode,
    killProcessTree,
    openBrowser,
    getSystemInfo,
  };
}

export function sanitizeFilename(rawName, fallback = "file") {
  const baseOnly = String(rawName || "")
    .replace(/[\r\n\0]/g, "")
    .split(/[/\\]/)
    .pop() || "";

  // Replace forbidden Windows/POSIX chars
  let cleaned = baseOnly
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();

  if (!cleaned || cleaned === "." || cleaned === "..") {
    cleaned = fallback;
  }

  const dotIdx = cleaned.lastIndexOf(".");
  let stem = dotIdx > 0 ? cleaned.slice(0, dotIdx) : cleaned;
  let ext = dotIdx > 0 ? cleaned.slice(dotIdx) : "";
  ext = ext.replace(/[. ]+$/g, "");

  if (WINDOWS_RESERVED_NAMES.has(stem.toUpperCase())) {
    stem = `_${stem}`;
  }

  const maxLen = 180;
  if (stem.length + ext.length > maxLen) {
    stem = stem.slice(0, Math.max(1, maxLen - ext.length));
  }

  return `${stem}${ext}` || fallback;
}

const defaultHelper = createPlatformHelper();

export const {
  platform: currentPlatform,
  arch: currentArch,
  isWindows,
  isLinux,
  isMac,
  npmBin,
  hasCommand,
  binPath,
  findPostgresTools,
  setSecureFileMode,
  killProcessTree,
  openBrowser,
  getSystemInfo,
} = defaultHelper;

