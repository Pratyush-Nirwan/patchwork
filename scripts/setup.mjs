#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  checkMinioBinary,
  runEasyPreflightChecks,
  runPreflightChecks,
} from "./setup/preflight.mjs";
import {
  provisionDatabase,
  runDatabaseMigrations,
} from "./setup/db.mjs";
import { setupMinioBucketAndVerify } from "./setup/minio.mjs";
import { ensureMinioBinary } from "./setup/download.mjs";
import {
  getLanIpAddresses,
  getSystemInfo,
} from "./lib/platform.mjs";
import { execFileSync } from "child_process";
import {
  buildFreshEnvValues,
  writeEnvFileAtomic,
  generateStrongPassword,
  redactSecretsInText,
} from "./setup/env.mjs";
import {
  createAndStoreAdminToken,
  createSharedInputSession,
  displayAndConfirmAdminToken,
  generateTokenEncryptionKeyHex,
} from "./setup/token.mjs";
import { handleDomainConfiguration } from "./setup/domain.mjs";
import { detectInstallState, formatStateTable } from "./setup/state-detect.mjs";
import { runRepair } from "./setup/repair.mjs";
import {
  runEasyInstall,
  runReset,
  getDeletionTargetsSummary,
} from "./setup/reset.mjs";
import { startApplicationServer } from "./setup/server.mjs";
import { displayVersion, version } from "./lib/version.mjs";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

export function parseCliArgs(argv = process.argv.slice(2)) {
  const flags = {
    help: false,
    yes: false,
    nonInteractive: false,
    easy: false,
    advanced: false,
    check: false,
    dev: false,
    noStart: false,
    noOpen: false,
    noDocs: false,
    action: process.env.SETUP_ACTION || "",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--yes" || arg === "-y") flags.yes = true;
    else if (arg === "--non-interactive") flags.nonInteractive = true;
    else if (arg === "--easy") flags.easy = true;
    else if (arg === "--advanced") flags.advanced = true;
    else if (arg === "--check") flags.check = true;
    else if (arg === "--dev") flags.dev = true;
    else if (arg === "--no-start") flags.noStart = true;
    else if (arg === "--no-open") flags.noOpen = true;
    else if (arg === "--no-docs") {
      flags.noDocs = true;
      process.env.SKIP_DOCS_BUILD = "1";
    }
    else if (arg.startsWith("--action=")) flags.action = arg.split("=")[1];
  }

  if (flags.easy && flags.advanced) {
    throw new Error("Cannot pass both --easy and --advanced.");
  }

  return flags;
}

export function printHelp(write = console.log) {
  write(`
${BOLD}Patchwork Interactive CLI Installer & System Setup${RESET}

Usage:
  npm run setup [-- [options]]
  node scripts/setup.mjs [options]

Options:
  --help, -h          Show this help message and exit
  --easy              Use Easy mode (managed PostgreSQL + downloaded MinIO)
  --advanced          Use Advanced mode (external PostgreSQL + MinIO)
  --check             Detect and print current installation status and exit (no changes)
  --yes, -y           Accept default values for all questions
  --non-interactive   Run without prompts (defaults to Easy mode unless --advanced is passed)
  --dev               Start the server with 'npm run dev' instead of 'npm run build && npm run start'
  --no-start          Skip starting the server after installation completes
  --no-open           Do not open the default browser automatically
  --no-docs           Skip building the embedded documentation bundle (sets SKIP_DOCS_BUILD=1)
  --action=<mode>     Action for existing installs in non-interactive mode (repair | reset | status)
`);
}

function createRedactingLogger(logsDir, knownSecrets = []) {
  fs.mkdirSync(logsDir, { recursive: true });
  const logPath = path.join(logsDir, `setup-${Date.now()}.log`);

  const writeLog = (level, msg) => {
    const safeMsg = redactSecretsInText(msg, knownSecrets);
    const line = `[${new Date().toISOString()}] [${level}] ${safeMsg}\n`;
    try {
      fs.appendFileSync(logPath, line, "utf8");
    } catch {
      // Best-effort logging
    }
  };

  return {
    logPath,
    info: (msg) => writeLog("INFO", msg),
    warn: (msg) => writeLog("WARN", msg),
    error: (msg) => writeLog("ERROR", msg),
    addSecret: (secret) => {
      if (secret && String(secret).length >= 6) {
        knownSecrets.push(String(secret));
      }
    },
  };
}

export function isRepoWithGitAndDevDeps(projectDir = process.cwd()) {
  try {
    const gitPath = path.join(projectDir, ".git");
    const pkgPath = path.join(projectDir, "package.json");
    if (!fs.existsSync(gitPath) || !fs.existsSync(pkgPath)) {
      return false;
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return Boolean(
      pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0
    );
  } catch {
    return false;
  }
}

async function runInteractiveStepWithRetry(
  stepName,
  fn,
  {
    interactive = true,
    isInteractiveTty = false,
    allowSkip = false,
    logger,
    writeOut,
    session,
    outputStream,
  }
) {
  while (true) {
    try {
      logger?.info(`Starting step: ${stepName}`);
      const res = await fn();
      logger?.info(`Completed step: ${stepName}`);
      return res;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger?.error(`Step '${stepName}' failed: ${errMsg}`);
      writeOut(`\n${RED}✖ ${stepName} failed:${RESET} ${errMsg}\n`);

      if (!interactive || !isInteractiveTty || !session) {
        throw err;
      }

      const options = [
        { value: "retry", label: "Retry this step" },
        ...(allowSkip ? [{ value: "skip", label: "Skip this step" }] : []),
        { value: "exit", label: "Exit installer" },
      ];

      const action = await session.promptSelect({
        message: `How would you like to proceed after '${stepName}' failure:`,
        options,
        initialValue: "retry",
        defaultOnCancel: "exit",
        summaryLabel: "Recovery action",
        outputStream,
      });

      if (action === "exit") {
        writeOut("Setup aborted by user.\n");
        process.exit(1);
      }
      if (action === "skip") {
        writeOut(`${YELLOW}⚠ Skipped step: ${stepName}${RESET}\n`);
        return null;
      }
    }
  }
}

export async function runCliSetup(rawArgs = process.argv.slice(2), io = {}) {
  const inputStream = io.inputStream || process.stdin;
  const outputStream = io.outputStream || process.stdout;
  const writeLine = (str = "") => outputStream.write(`${str}\n`);
  const rawTty = Boolean(
    inputStream === process.stdin &&
      typeof inputStream.setRawMode === "function" &&
      outputStream.isTTY
  );
  const simulatedTty = Boolean(
    io.isTTY !== undefined
      ? io.isTTY
      : process.env.SETUP_SIMULATE_TTY === "1" ||
          outputStream.isTTY ||
          inputStream.isTTY
  );
  const isInteractiveTty = Boolean(rawTty || simulatedTty);

  const flags = parseCliArgs(rawArgs);
  if (flags.help) {
    printHelp(writeLine);
    return { exitCode: 0, mode: "help" };
  }

  const projectDir = process.env.SETUP_PROJECT_DIR
    ? path.resolve(process.env.SETUP_PROJECT_DIR)
    : process.cwd();
  const envPath = process.env.SETUP_ENV_PATH
    ? path.resolve(process.env.SETUP_ENV_PATH)
    : path.join(projectDir, ".env");
  const minioDataDir = process.env.SETUP_MINIO_DATA_DIR
    ? path.resolve(process.env.SETUP_MINIO_DATA_DIR)
    : path.join(projectDir, ".minio-data");
  const logsDir = process.env.SETUP_LOGS_DIR
    ? path.resolve(process.env.SETUP_LOGS_DIR)
    : path.join(projectDir, "logs");
  const backupsDir = process.env.SETUP_BACKUPS_DIR
    ? path.resolve(process.env.SETUP_BACKUPS_DIR)
    : path.join(projectDir, "backups");
  const drizzleDir = path.join(process.cwd(), "drizzle");

  // Single shared @clack/prompts input session for the entire installer run
  const sharedInputSession =
    io.inputSession || createSharedInputSession(inputStream);
  const ownsInputSession = !io.inputSession;

  try {
    // Fix 1: Detect state silently on launch. Print status table ONLY on --check, Repair, or Show status only.
    const detectedState = await detectInstallState({
      projectDir,
      envPath,
      minioDataDir,
      drizzleDir,
      checkMinioAnyway: true,
    });

    if (flags.check) {
      writeLine(formatStateTable(detectedState));
      if (detectedState.upgradeAvailable) {
        writeLine(
          `${YELLOW}Upgrade available: run migrations (npm run db:migrate). See https://getpatchwork.in/documentation/operations/backups-and-upgrades/${RESET}`
        );
      }
      return {
        exitCode: 0,
        mode: "check",
        state: detectedState,
      };
    }

    const interactive = !flags.nonInteractive && !flags.yes;
    const logger = createRedactingLogger(logsDir);

    const onSigInt = () => {
      logger.warn("Received SIGINT (Ctrl+C). Exiting cleanly.");
      writeLine(
        `\n${YELLOW}⚠ Setup interrupted (Ctrl+C). No partial .env files were left behind.${RESET}`
      );
      process.exit(130);
    };
    process.once("SIGINT", onSigInt);

    try {
      writeLine(
        `\n${BOLD}${CYAN}┌──────────────────────────────────────────────────────────────────────────┐${RESET}`
      );
      writeLine(
        `${BOLD}${CYAN}│  Patchwork ${displayVersion} — Native Server CLI Installer${" ".repeat(Math.max(0, 29 - displayVersion.length))}│${RESET}`
      );
      writeLine(
        `${BOLD}${CYAN}└──────────────────────────────────────────────────────────────────────────┘${RESET}`
      );
      writeLine(
        "This installer checks prerequisites, configures PostgreSQL & MinIO, generates\nencrypted secrets, runs database migrations, and issues your one-time Admin Setup Token.\n"
      );

      logger.info(`Initial install state: ${detectedState.overallState}`);

      // Handle existing partial or complete installation
      if (detectedState.overallState !== "fresh") {
        // Fix 1: Show only a one-line note on existing install, NOT the status table
        writeLine(`${YELLOW}Existing installation detected.${RESET}`);

        // Fix 2: Detect an unconsumed token that was never confirmed as saved -> Reset is the ONLY option
        const unconfirmedTokenDetected =
          detectedState.token.exists &&
          !detectedState.token.consumed &&
          !detectedState.token.confirmed;

        if (unconfirmedTokenDetected) {
          writeLine(
            `${RED}✖ Unconfirmed admin setup token detected. The token was generated on a previous run before confirmation ('saved') was completed. Because the token cannot be re-displayed, the only option is Reset.${RESET}`
          );
        }

        let chosenAction = flags.action;

        if (!chosenAction) {
          if (!interactive || !isInteractiveTty) {
            if (unconfirmedTokenDetected) {
              throw new Error(
                "Unconfirmed admin setup token detected. The only available option is Reset (--action=reset)."
              );
            }
            if (detectedState.overallState === "complete") {
              writeLine(
                `${GREEN}✔ Existing installation is complete and healthy. No changes made.${RESET}`
              );
              logger.info("Existing install healthy; exiting with no changes.");
              return {
                exitCode: 0,
                mode: "noop-complete",
                state: detectedState,
              };
            }
            chosenAction = "repair";
          } else {
            const menuOptions = unconfirmedTokenDetected
              ? [
                  {
                    value: "reset",
                    label: "Reset (destructive — wipe and reinstall)",
                  },
                  { value: "exit", label: "Exit" },
                ]
              : [
                  {
                    value: "repair",
                    label: "Repair (non-destructive — restore missing pieces)",
                  },
                  {
                    value: "reset",
                    label: "Reset (destructive — wipe and reinstall)",
                  },
                  { value: "status", label: "Show status only" },
                  { value: "exit", label: "Exit" },
                ];

            chosenAction = await sharedInputSession.promptSelect({
              message: "Select an action for the existing installation:",
              options: menuOptions,
              initialValue: menuOptions[0].value,
              defaultOnCancel: "exit",
              summaryLabel: "Action",
              outputStream,
            });

            if (unconfirmedTokenDetected && chosenAction !== "reset") {
              return {
                exitCode: 0,
                mode: "unconfirmed-token-reset-only",
                onlyOptionIsReset: true,
                state: detectedState,
              };
            }
            if (chosenAction === "exit") {
              return { exitCode: 0, mode: "exit", state: detectedState };
            }
          }
        }

        if (
          unconfirmedTokenDetected &&
          chosenAction !== "reset" &&
          chosenAction !== "exit"
        ) {
          throw new Error(
            "Unconfirmed admin setup token detected. Repair is unavailable; the only option is Reset."
          );
        }

        if (chosenAction === "status") {
          // Fix 1: Print status table when user chooses "Show status only"
          writeLine(formatStateTable(detectedState));
          return { exitCode: 0, mode: "status", state: detectedState };
        }

        if (chosenAction === "repair") {
          // Fix 1: Print status table first on Repair, then proceed with repair steps
          writeLine(formatStateTable(detectedState));
          writeLine(`\n${CYAN}==> Running non-destructive Repair...${RESET}`);
          const repairRes = await runRepair({
            projectDir,
            envPath,
            minioDataDir,
            drizzleDir,
            devMode: flags.dev || process.env.NODE_ENV === "development",
          });

          writeLine(`\n${BOLD}Repair Report:${RESET}`);
          writeLine(
            `  Issues found: ${repairRes.found.length ? repairRes.found.join("; ") : "None"}`
          );
          writeLine(
            `  Fixed:        ${repairRes.fixed.length ? repairRes.fixed.join("; ") : "Nothing needed fixing"}`
          );
          if (repairRes.manualActions.length > 0) {
            for (const manual of repairRes.manualActions) {
              writeLine(`  ${RED}✖ Manual Action Required:${RESET} ${manual}`);
            }
          } else {
            writeLine(`  ${GREEN}✔ Repair finished cleanly.${RESET}`);
          }

          logger.info(
            `Repair summary: found=${repairRes.found.length}, fixed=${repairRes.fixed.length}, manual=${repairRes.manualActions.length}`
          );

          return {
            exitCode: 0,
            mode: "repair",
            repair: repairRes,
          };
        }

        if (chosenAction === "reset") {
          // Fix 1: Never print the status table during Reset
          const parsedDbUrl = detectedState.database.url
            ? new URL(detectedState.database.url)
            : null;
          const targetDbName =
            (parsedDbUrl
              ? decodeURIComponent(parsedDbUrl.pathname.replace(/^\//, ""))
              : "") ||
            process.env.SETUP_DB_NAME ||
            "patchwork";

          const targets = getDeletionTargetsSummary({
            dbName: targetDbName,
            s3Bucket: detectedState.minio.bucket,
            minioDataDir,
            envPath,
          });

          writeLine(`\n${RED}${BOLD}⚠ DESTRUCTIVE RESET WARNING:${RESET}`);
          writeLine("The following resources will be permanently deleted:");
          for (const item of targets) {
            writeLine(`  ${RED}•${RESET} ${item}`);
          }

          let backupDb = process.env.SETUP_RESET_BACKUP_DB === "true";
          let backupMinio = process.env.SETUP_RESET_BACKUP_MINIO === "true";
          let typedConfirmation = process.env.SETUP_RESET_CONFIRM_DB || "";
          let secondConfirmation =
            process.env.SETUP_RESET_CONFIRM_YES === "true" || flags.yes;

          if (interactive && isInteractiveTty && !typedConfirmation) {
            const wantBackup = await sharedInputSession.promptConfirm({
              message:
                "Create a backup first (pg_dump to ./backups and copy of MinIO data dir)?",
              initialValue: true,
              summaryLabel: "Create backup first",
              outputStream,
            });
            backupDb = Boolean(wantBackup);
            backupMinio = Boolean(wantBackup);

            const typed = await sharedInputSession.promptText({
              message: `Type the database name (${targetDbName}) to confirm deletion`,
              defaultValue: "",
              summaryLabel: "Confirm database name",
              outputStream,
            });
            typedConfirmation = String(typed).trim();

            const confirm2 = await sharedInputSession.promptConfirm({
              message: `Are you sure you want to permanently destroy '${targetDbName}' and all MinIO data?`,
              initialValue: false,
              summaryLabel: "Confirm permanent deletion",
              outputStream,
            });
            secondConfirmation = Boolean(confirm2);
          }

          const resetRes = await runReset({
            projectDir,
            envPath,
            minioDataDir,
            backupsDir,
            drizzleDir,
            dbName: targetDbName,
            typedConfirmation,
            secondConfirmation,
            backupDb,
            backupMinio,
            reinstall: false,
            devMode: flags.dev || process.env.NODE_ENV === "development",
          });

          writeLine(`\n${GREEN}✔ Reset completed.${RESET}`);
          writeLine(`  Database '${targetDbName}', MinIO data, and .env were removed.`);
          writeLine(`  All installation state has been wiped to a clean slate.\n`);

          let startFresh = false;
          if (interactive && isInteractiveTty) {
            startFresh = await sharedInputSession.promptConfirm({
              message: "Start fresh installation now?",
              initialValue: true,
              summaryLabel: "Start fresh installation",
              outputStream,
            });
          }

          if (!startFresh) {
            writeLine("Run 'npm run setup' whenever you are ready to configure Patchwork.\n");
            return {
              exitCode: 0,
              mode: "reset",
              reset: resetRes,
            };
          }
        }
      }

      // ─── FRESH INSTALL FLOW (No status table printed on fresh install) ──────────
      let installMode = flags.easy
        ? "easy"
        : flags.advanced
          ? "advanced"
          : !interactive || !isInteractiveTty
            ? "easy"
            : null;

      if (!installMode) {
        installMode = await sharedInputSession.promptSelect({
          message: "How do you want to install Patchwork?",
          options: [
            {
              value: "easy",
              label: "Easy (recommended) — Patchwork sets up PostgreSQL and MinIO for you inside this folder",
            },
            {
              value: "advanced",
              label: "Advanced — Use my own PostgreSQL and MinIO",
            },
          ],
          initialValue: "easy",
          summaryLabel: "Install mode",
          outputStream,
        });
      }

      if (installMode === "easy") {
        const sysInfo = getSystemInfo();
        if (sysInfo.isLinux && sysInfo.isRoot) {
          writeLine(
            `${RED}✖ Running Easy mode as root is not supported (PostgreSQL refuses to run as root).${RESET}`
          );
          let createUser = false;
          if (interactive && isInteractiveTty) {
            createUser = await sharedInputSession.promptConfirm({
              message: "Create a dedicated 'patchwork' system user and transfer folder ownership?",
              initialValue: false,
              summaryLabel: "Create patchwork user",
              outputStream,
            });
          }
          if (createUser) {
            execFileSync("useradd", ["--system", "--create-home", "--shell", "/bin/bash", "patchwork"], {
              stdio: "inherit",
              shell: false,
            });
            execFileSync("chown", ["-R", "patchwork:patchwork", projectDir], {
              stdio: "inherit",
              shell: false,
            });
            writeLine(
              `${GREEN}✔ Created 'patchwork' user. Re-run setup as that user:${RESET}\n  sudo -u patchwork npm run setup -- --easy`
            );
            return { exitCode: 0, mode: "root-handoff" };
          }
          throw new Error(
            "PostgreSQL refuses to run as root. Re-run as a normal user (or create a dedicated 'patchwork' user)."
          );
        }

        writeLine(`${CYAN}==> [Step 1/5] Running Easy mode preflight checks...${RESET}`);
        const appPortDefault = Number(process.env.SETUP_APP_PORT || 3000);
        const easyPre = await runEasyPreflightChecks({
          projectDir,
          appPort: appPortDefault,
        });
        for (const check of easyPre.checks) {
          if (check.passed) {
            writeLine(`  ${GREEN}✔${RESET} ${check.label} — ${check.detail}`);
          } else {
            writeLine(`  ${RED}✖${RESET} ${check.label} — ${check.detail}`);
            writeLine(`    ${YELLOW}Fix:${RESET} ${check.fixHint}`);
          }
        }
        if (!easyPre.passed) {
          throw new Error("Preflight checks failed. Resolve the issues above and re-run `npm run setup`.");
        }

        let exposure = "only-me";
        let minioBindHost = "127.0.0.1";
        let minioPublicUrl = null;
        let appUrl = process.env.SETUP_APP_URL || `http://localhost:${appPortDefault}`;

        if (interactive && isInteractiveTty) {
          exposure = await sharedInputSession.promptSelect({
            message: "Will other people reach Patchwork over the network, or only you on this computer?",
            options: [
              { value: "only-me", label: "Only me on this computer (localhost)" },
              { value: "other-people", label: "Other people over the network" },
            ],
            initialValue: "only-me",
            summaryLabel: "Network exposure",
            outputStream,
          });
        }

        if (exposure === "other-people") {
          const connectType = await sharedInputSession.promptSelect({
            message: "How will other people connect?",
            options: [
              { value: "domain", label: "Domain + HTTPS reverse proxy (recommended)" },
              { value: "lan", label: "Trusted LAN IP (unencrypted HTTP)" },
            ],
            initialValue: "domain",
            summaryLabel: "Network mode",
            outputStream,
          });

          if (connectType === "domain") {
            const domainName = await sharedInputSession.promptText({
              message: "Enter your domain name",
              defaultValue: "tickets.example.com",
              summaryLabel: "Domain name",
              outputStream,
            });
            const proxyType = await sharedInputSession.promptSelect({
              message: "Choose reverse proxy configuration",
              options: [
                { value: "caddy", label: "Caddy (deploy/Caddyfile)" },
                { value: "nginx", label: "Nginx + Certbot (deploy/nginx.conf)" },
              ],
              initialValue: "caddy",
              summaryLabel: "Reverse proxy",
              outputStream,
            });
            const domainRes = handleDomainConfiguration({
              choice: "yes",
              domainName,
              proxyType,
              appPort: appPortDefault,
              s3Port: 19000,
              projectDir,
              appRootDir: process.cwd(),
            });
            appUrl = domainRes.appUrl;
            minioPublicUrl = domainRes.minioPublicUrl;
          } else {
            const lanIps = getLanIpAddresses();
            const defaultIp = lanIps[0] || "192.168.1.10";
            const lanIp = await sharedInputSession.promptText({
              message: "Enter your LAN IP address for Patchwork and MinIO",
              defaultValue: defaultIp,
              summaryLabel: "LAN IP",
              outputStream,
            });
            writeLine(
              `  ${YELLOW}⚠ Warning: LAN HTTP (${lanIp}) is unencrypted. Use a reverse proxy with HTTPS for untrusted networks.${RESET}`
            );
            minioBindHost = lanIp.trim();
            appUrl = `http://${minioBindHost}:${appPortDefault}`;
          }
        }

        writeLine(`\n${CYAN}==> [Step 2/5] Provisioning PostgreSQL & MinIO in ./data/...${RESET}`);
        const requireTokenConfirm =
          (interactive && isInteractiveTty) ||
          process.env.SETUP_REQUIRE_TOKEN_CONFIRM === "true";

        const easyRes = await runEasyInstall({
          projectDir,
          envPath,
          drizzleDir,
          appPort: appPortDefault,
          appUrl,
          minioBindHost,
          minioPublicUrl,
          yes: !interactive,
          tokenConfirmed: !requireTokenConfirm,
          confirmDownload: async ({ name, sizeLabel, url }) => {
            if (!interactive || !isInteractiveTty) return true;
            return sharedInputSession.promptConfirm({
              message: `Download official MinIO binary?\n  Name: ${name}\n  Size: ${sizeLabel}\n  URL : ${url}`,
              initialValue: true,
              summaryLabel: "Download MinIO",
              outputStream,
            });
          },
          onDownloadProgress: ({ received, total }) => {
            if (!outputStream.isTTY) return;
            const mb = (received / (1024 * 1024)).toFixed(1);
            const pct = total > 0 ? ` (${Math.round((received / total) * 100)}%)` : "";
            outputStream.write(`\r  Downloading MinIO: ${mb} MB${pct}   `);
          },
          onBeforeStop: async ({ databaseUrl, tokenBuffer }) => {
            if (outputStream.isTTY) outputStream.write("\n");
            writeLine(`\n${CYAN}==> [Step 3/5] One-time Admin Setup Token...${RESET}`);
            await displayAndConfirmAdminToken({
              tokenBuffer,
              databaseUrl,
              inputSession: sharedInputSession,
              inputStream,
              outputStream,
              isTTY: requireTokenConfirm,
              nonInteractive: !requireTokenConfirm,
              ansiSupported: isInteractiveTty || Boolean(outputStream.isTTY),
            });
          },
        });

        try {
          fs.writeFileSync(
            path.join(projectDir, ".patchwork-version.json"),
            `${JSON.stringify({ version, displayVersion, installedAt: new Date().toISOString() }, null, 2)}\n`,
            "utf8"
          );
        } catch {}

        writeLine(`\n${CYAN}==> [Step 4/5] Installation Summary (${displayVersion}, Easy mode)${RESET}`);
        writeLine(`  ${GREEN}✔${RESET} Version:          Patchwork ${displayVersion}`);
        writeLine(`  ${GREEN}✔${RESET} PostgreSQL 18:    ${easyRes.pgDataDir} (port ${easyRes.dbPort})`);
        writeLine(`  ${GREEN}✔${RESET} MinIO Bucket:     ${easyRes.minio.bucket} (${easyRes.minio.publicUrl})`);
        writeLine(`  ${GREEN}✔${RESET} Setup Log:        ${logger.logPath}`);
        writeLine(`  ${GREEN}✔${RESET} Documentation:    https://getpatchwork.in/documentation/`);

        writeLine(`\n${CYAN}==> [Step 5/5] Starting Patchwork supervisor...${RESET}`);
        const serverRes = await startApplicationServer({
          projectDir,
          appRootDir: process.cwd(),
          envPath,
          desiredPort: appPortDefault,
          devMode: flags.dev,
          noStart: flags.noStart,
          noOpen: flags.noOpen,
          nonInteractive: !interactive,
          interactive,
          healthTimeoutMs: 90000,
          skipBuildIfAlreadyBuilt:
            process.env.SETUP_SKIP_BUILD_IF_BUILT === "true" || Boolean(process.env.VITEST),
          confirmPortChange: async (busyPort, nextPort) => {
            if (!interactive || !isInteractiveTty) return true;
            return sharedInputSession.promptConfirm({
              message: `Port ${busyPort} is in use. Retry on ${nextPort} and update .env?`,
              initialValue: true,
              summaryLabel: `Retry on port ${nextPort}`,
              outputStream,
            });
          },
          confirmLinuxSystemd: async () => {
            if (!interactive || !isInteractiveTty) return false;
            return sharedInputSession.promptConfirm({
              message: "Install, enable, and start patchwork.service (supervises PG + MinIO + App)?",
              initialValue: true,
              summaryLabel: "Install systemd service",
              outputStream,
            });
          },
          outputStream,
        });

        return {
          exitCode: 0,
          mode: "easy-install",
          envPath,
          databaseUrl: easyRes.databaseUrl,
          logPath: logger.logPath,
          server: serverRes,
        };
      }

      // Advanced mode: offer "Install MinIO for me" if binary is missing
      const advMinioCheck = checkMinioBinary(projectDir);
      if (!advMinioCheck.passed && interactive && isInteractiveTty) {
        const minioChoice = await sharedInputSession.promptSelect({
          message: "MinIO binary not found in ./bin. How would you like to provide MinIO?",
          options: [
            { value: "install", label: "Install MinIO for me (verified SHA-256 download)" },
            { value: "manual", label: "I already have MinIO / will install it manually" },
          ],
          initialValue: "install",
          summaryLabel: "MinIO binary",
          outputStream,
        });
        if (minioChoice === "install") {
          await ensureMinioBinary({
            projectDir,
            yes: false,
            confirmDownload: async ({ name, sizeLabel, url }) =>
              sharedInputSession.promptConfirm({
                message: `Download MinIO (${name}, ${sizeLabel}) from ${url}?`,
                initialValue: true,
                summaryLabel: "Download MinIO",
                outputStream,
              }),
          });
        }
      }

      writeLine(`${CYAN}==> [Step 1/9] Running preflight checks...${RESET}`);
      const superuserUrl =
        process.env.SETUP_PG_SUPERUSER_URL ||
        "postgres://postgres:postgres@localhost:5432/postgres";
      const appPortDefault = Number(process.env.SETUP_APP_PORT || 3000);
      const s3EndpointDefault =
        process.env.SETUP_S3_ENDPOINT || "http://127.0.0.1:9000";
      const minioApiPort = Number(new URL(s3EndpointDefault).port || 9000);
      const minioConsolePort = Number(
        process.env.SETUP_S3_CONSOLE_PORT || 9001
      );

      const preflight = await runPreflightChecks({
        projectDir,
        minioDataDir,
        pgConnectionUrl: superuserUrl,
        appPort: appPortDefault,
        minioApiPort,
        minioConsolePort,
        allowRunningMinio: true,
        allowRunningApp: true,
      });

      for (const check of preflight.checks) {
        if (check.passed) {
          writeLine(`  ${GREEN}✔${RESET} ${check.label} — ${check.detail}`);
        } else {
          writeLine(`  ${RED}✖${RESET} ${check.label} — ${check.detail}`);
          writeLine(`    ${YELLOW}Fix:${RESET} ${check.fixHint}`);
        }
      }

      if (!preflight.passed) {
        throw new Error(
          "Preflight checks failed. Resolve the reported issues above and re-run `npm run setup`."
        );
      }

      // Step 2: Database configuration
      // Fix 4: Remove the "Also create 'patchwork_test' database?" prompt from the default flow.
      // Create patchwork_test only in dev mode (--dev, NODE_ENV=development, or .git + devDependencies + user confirms "Set up a development environment?").
      writeLine(
        `\n${CYAN}==> [Step 2/9] Configuring PostgreSQL database...${RESET}`
      );
      let dbHost = process.env.SETUP_DB_HOST || "localhost";
      let dbPort = Number(process.env.SETUP_DB_PORT || 5432);
      let dbName = process.env.SETUP_DB_NAME || "patchwork";
      let dbUser = process.env.SETUP_DB_USER || "patchwork";
      const dbPassword =
        process.env.SETUP_DB_PASSWORD || generateStrongPassword(20);

      let isDevEnvironment =
        Boolean(flags.dev) || process.env.NODE_ENV === "development";

      if (interactive && isInteractiveTty) {
        dbHost = await sharedInputSession.promptText({
          message: "PostgreSQL host",
          defaultValue: dbHost,
          summaryLabel: "PostgreSQL host",
          outputStream,
        });
        const portAns = await sharedInputSession.promptText({
          message: "PostgreSQL port",
          defaultValue: String(dbPort),
          summaryLabel: "PostgreSQL port",
          outputStream,
        });
        dbPort = Number(portAns) || dbPort;
        dbName = await sharedInputSession.promptText({
          message: "Database name",
          defaultValue: dbName,
          summaryLabel: "Database name",
          outputStream,
        });
        dbUser = await sharedInputSession.promptText({
          message: "Database application user",
          defaultValue: dbUser,
          summaryLabel: "Database user",
          outputStream,
        });
      }

      if (
        !isDevEnvironment &&
        interactive &&
        isInteractiveTty &&
        isRepoWithGitAndDevDeps(projectDir)
      ) {
        isDevEnvironment = await sharedInputSession.promptConfirm({
          message: "Set up a development environment?",
          initialValue: false,
          summaryLabel: "Development environment",
          outputStream,
        });
      }

      logger.addSecret(dbPassword);

      const dbProvision = await runInteractiveStepWithRetry(
        "Database Provisioning",
        () =>
          provisionDatabase({
            superuserUrl,
            host: dbHost,
            port: dbPort,
            dbName,
            dbUser,
            dbPassword,
            createTestDb: isDevEnvironment,
          }),
        {
          interactive,
          isInteractiveTty,
          allowSkip: false,
          logger,
          writeOut: (s) => outputStream.write(s),
          session: sharedInputSession,
          outputStream,
        }
      );
      writeLine(
        `  ${GREEN}✔${RESET} Database '${dbName}' and role '${dbUser}' verified (pgcrypto enabled).`
      );

      // Step 3: MinIO setup
      writeLine(
        `\n${CYAN}==> [Step 3/9] Configuring MinIO object storage...${RESET}`
      );
      const s3AccessKey = process.env.SETUP_S3_ACCESS_KEY || "minioadmin";
      const s3SecretKey =
        process.env.SETUP_S3_SECRET_KEY ||
        (s3AccessKey === "minioadmin"
          ? "minioadmin"
          : generateStrongPassword(24));
      const s3Bucket = process.env.SETUP_S3_BUCKET || "patchwork";
      logger.addSecret(s3SecretKey);

      const minioRes = await runInteractiveStepWithRetry(
        "MinIO Bucket & Read/Write Verification",
        () =>
          setupMinioBucketAndVerify({
            projectDir,
            dataDir: minioDataDir,
            endpoint: s3EndpointDefault,
            consolePort: minioConsolePort,
            accessKeyId: s3AccessKey,
            secretAccessKey: s3SecretKey,
            bucket: s3Bucket,
          }),
        {
          interactive,
          isInteractiveTty,
          allowSkip: false,
          logger,
          writeOut: (s) => outputStream.write(s),
          session: sharedInputSession,
          outputStream,
        }
      );
      writeLine(
        `  ${GREEN}✔${RESET} MinIO bucket '${s3Bucket}' verified with read/write test object.`
      );
      writeLine(`  ${YELLOW}ℹ${RESET} ${minioRes.systemdStatus.message}`);

      // Step 4: Domain & HTTPS Guidance
      writeLine(
        `\n${CYAN}==> [Step 4/9] Domain & HTTPS configuration...${RESET}`
      );
      let domainChoice = process.env.SETUP_DOMAIN_CHOICE || "no";
      let domainName = process.env.SETUP_DOMAIN_NAME || "tickets.example.com";
      let proxyType = process.env.SETUP_PROXY_TYPE || "caddy";

      if (interactive && isInteractiveTty) {
        domainChoice = await sharedInputSession.promptSelect({
          message: "Do you want to connect a domain?",
          options: [
            {
              value: "no",
              label: "No (use localhost / configure manually)",
            },
            {
              value: "yes",
              label: "Yes (configure domain and reverse proxy now)",
            },
            {
              value: "later",
              label: "Later (save step-by-step guide to DOMAIN_SETUP.md)",
            },
          ],
          initialValue: domainChoice,
          summaryLabel: "Domain",
          formatSummaryValue: (val) => {
            if (val === "later") {
              return "later (guide saved to DOMAIN_SETUP.md)";
            }
            if (val === "no") {
              return "no (localhost)";
            }
            return String(val);
          },
          outputStream,
        });

        if (domainChoice === "yes") {
          domainName = await sharedInputSession.promptText({
            message: "Enter your domain name",
            defaultValue: domainName,
            summaryLabel: "Domain name",
            outputStream,
          });
          proxyType = await sharedInputSession.promptSelect({
            message: "Choose reverse proxy configuration to generate",
            options: [
              {
                value: "caddy",
                label: "Caddy (deploy/Caddyfile with automatic HTTPS)",
              },
              {
                value: "nginx",
                label: "Nginx + Certbot (deploy/nginx.conf)",
              },
            ],
            initialValue: proxyType,
            summaryLabel: "Reverse proxy",
            outputStream,
          });
        }
      }

      const domainRes = await handleDomainConfiguration({
        projectDir,
        choice: domainChoice,
        domain: domainName,
        publicUrl: process.env.SETUP_APP_URL,
        appPort: appPortDefault,
        minioPort: minioApiPort,
        proxyType,
      });

      if (domainRes.choice === "later") {
        writeLine(
          `  ${GREEN}✔${RESET} Wrote domain setup instructions to ${domainRes.domainSetupDocPath}`
        );
      } else if (domainRes.choice === "yes") {
        writeLine(
          `  ${GREEN}✔${RESET} Generated reverse proxy config at ${domainRes.generatedProxyPath}`
        );
        writeLine(`\n${domainRes.guide}`);
      }

      // Step 5: Write .env atomically (mode 600, backup if exists)
      writeLine(`\n${CYAN}==> [Step 5/9] Writing .env configuration...${RESET}`);
      const tokenEncryptionKey =
        process.env.SETUP_TOKEN_ENCRYPTION_KEY ||
        generateTokenEncryptionKeyHex();
      const sessionSecret = generateStrongPassword(32);
      const csrfSecret = generateStrongPassword(32);

      logger.addSecret(tokenEncryptionKey);
      logger.addSecret(sessionSecret);
      logger.addSecret(csrfSecret);

      const envValues = buildFreshEnvValues({
        databaseUrl: dbProvision.databaseUrl,
        appPort: appPortDefault,
        appUrl: process.env.SETUP_APP_URL || domainRes.appUrl,
        sessionSecret,
        csrfSecret,
        tokenEncryptionKey,
        s3Endpoint: s3EndpointDefault,
        s3AccessKey,
        s3SecretKey,
        s3Bucket,
        minioPublicUrl: domainRes.minioPublicUrl,
      });

      const envWrite = writeEnvFileAtomic(envPath, envValues, { backup: true });
      if (envWrite.backupPath) {
        writeLine(
          `  ${YELLOW}ℹ${RESET} Backed up existing .env to ${path.basename(envWrite.backupPath)}`
        );
      }
      const permLabel = envWrite.permission?.enforced
        ? envWrite.permission.detail
        : `WARNING: permissions not restricted (${envWrite.permission?.detail || "unverified"})`;
      writeLine(`  ${GREEN}✔${RESET} Wrote ${envPath} (${permLabel}).`);

      // Fix 4: Write .env.test ONLY in dev mode; never add TEST_DATABASE_URL to production .env
      if (isDevEnvironment && dbProvision.testDatabaseUrl) {
        const envTestPath = path.join(projectDir, ".env.test");
        const testEnvValues = buildFreshEnvValues({
          databaseUrl: dbProvision.testDatabaseUrl,
          appPort: appPortDefault,
          appUrl: process.env.SETUP_APP_URL || domainRes.appUrl,
          sessionSecret,
          csrfSecret,
          tokenEncryptionKey,
          s3Endpoint: s3EndpointDefault,
          s3AccessKey,
          s3SecretKey,
          s3Bucket: `${s3Bucket}-test`,
          minioPublicUrl: domainRes.minioPublicUrl,
        });
        writeEnvFileAtomic(envTestPath, testEnvValues, { backup: false });
      }

      // Step 6: Run migrations and verify schema
      writeLine(
        `\n${CYAN}==> [Step 6/9] Running database migrations...${RESET}`
      );
      const migStatus = await runInteractiveStepWithRetry(
        "Database Migrations",
        async () => {
          const mainMig = await runDatabaseMigrations(
            dbProvision.databaseUrl,
            drizzleDir
          );
          if (isDevEnvironment && dbProvision.testDatabaseUrl) {
            await runDatabaseMigrations(
              dbProvision.testDatabaseUrl,
              drizzleDir
            );
          }
          return mainMig;
        },
        {
          interactive,
          isInteractiveTty,
          allowSkip: false,
          logger,
          writeOut: (s) => outputStream.write(s),
          session: sharedInputSession,
          outputStream,
        }
      );
      writeLine(
        `  ${GREEN}✔${RESET} Applied ${migStatus.appliedMigrations}/${migStatus.totalMigrations} migrations and verified schema.`
      );

      // Step 7: Generate and encrypt Admin Setup Token (Fix 2 & Fix 5)
      writeLine(
        `\n${CYAN}==> [Step 7/9] Generating one-time Admin Setup Token...${RESET}`
      );
      const requireTokenConfirm =
        (interactive && isInteractiveTty) ||
        process.env.SETUP_REQUIRE_TOKEN_CONFIRM === "true";

      const tokenRes = await createAndStoreAdminToken({
        databaseUrl: dbProvision.databaseUrl,
        encryptionKey: tokenEncryptionKey,
        keyVersion: 1,
        confirmed: !requireTokenConfirm,
      });

      logger.info(
        "Generated and stored AES-256-GCM encrypted Admin Setup Token in setup_token (plaintext redacted & zeroed)."
      );

      await displayAndConfirmAdminToken({
        tokenBuffer: tokenRes.tokenBuffer,
        databaseUrl: dbProvision.databaseUrl,
        inputSession: sharedInputSession,
        inputStream,
        outputStream,
        isTTY: requireTokenConfirm,
        nonInteractive: !requireTokenConfirm,
        ansiSupported: isInteractiveTty || Boolean(outputStream.isTTY),
      });

      // Step 8 & 9: Summary + Automatic Server Start (Fix 3)
      try {
        fs.writeFileSync(
          path.join(projectDir, ".patchwork-version.json"),
          `${JSON.stringify({ version, displayVersion, installedAt: new Date().toISOString() }, null, 2)}\n`,
          "utf8"
        );
      } catch {
        // Best-effort version marker
      }
      writeLine(`\n${CYAN}==> [Step 8/9] Installation Summary (${displayVersion})${RESET}`);
      writeLine(`  ${GREEN}✔${RESET} Version:          Patchwork ${displayVersion}`);
      writeLine(`  ${GREEN}✔${RESET} Environment file: ${envPath}`);
      writeLine(
        `  ${GREEN}✔${RESET} Database:         ${dbName} (user: ${dbUser})`
      );
      writeLine(
        `  ${GREEN}✔${RESET} MinIO Bucket:     ${s3Bucket} (${s3EndpointDefault})`
      );
      writeLine(`  ${GREEN}✔${RESET} Setup Log:        ${logger.logPath}`);
      writeLine(
        `  ${GREEN}✔${RESET} Documentation:    https://getpatchwork.in/documentation/`
      );

      writeLine(`\n${CYAN}==> [Step 9/9] Starting Patchwork server...${RESET}`);
      const serverRes = await startApplicationServer({
        projectDir,
        appRootDir: process.cwd(),
        envPath,
        desiredPort: appPortDefault,
        devMode: flags.dev,
        noStart: flags.noStart,
        noOpen: flags.noOpen,
        nonInteractive: !interactive,
        interactive,
        skipBuildIfAlreadyBuilt:
          process.env.SETUP_SKIP_BUILD_IF_BUILT === "true" ||
          Boolean(process.env.VITEST),
        confirmPortChange: async (busyPort, nextPort) => {
          if (!interactive || !isInteractiveTty) return true;
          return sharedInputSession.promptConfirm({
            message: `Port ${busyPort} is in use. Retry on next free port (${nextPort}) and update APP_URL in .env?`,
            initialValue: true,
            summaryLabel: `Retry on port ${nextPort}`,
            outputStream,
          });
        },
        confirmLinuxSystemd: async () => {
          if (!interactive || !isInteractiveTty) return false;
          return sharedInputSession.promptConfirm({
            message: "Install, enable, and start patchwork.service via systemd?",
            initialValue: true,
            summaryLabel: "Install systemd service",
            outputStream,
          });
        },
        outputStream,
      });

      return {
        exitCode: 0,
        mode: "fresh-install",
        envPath,
        databaseUrl: dbProvision.databaseUrl,
        testDatabaseUrl: dbProvision.testDatabaseUrl,
        testDbCreated: dbProvision.testDbCreated,
        logPath: logger.logPath,
        server: serverRes,
      };
    } finally {
      process.removeListener("SIGINT", onSigInt);
    }
  } finally {
    if (ownsInputSession) {
      sharedInputSession.close();
    }
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  runCliSetup().then(
    (res) => {
      process.exit(res?.exitCode ?? 0);
    },
    (err) => {
      console.error(
        `\n${RED}✖ Setup failed:${RESET} ${err instanceof Error ? err.message : String(err)}`
      );
      process.exit(1);
    }
  );
}
