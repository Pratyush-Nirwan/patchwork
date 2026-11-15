import fs from "node:fs";
import path from "node:path";
import {
  findRepoRoot,
  extractCommands,
  extractShortcuts,
  extractPermissions,
  extractEnvVars,
  extractSystemSettings,
  extractInstallerCli,
  extractApiRouteGroups,
} from "./extract.mjs";

export function checkCoverage(
  repoRoot = findRepoRoot(),
  refDir = path.join(repoRoot, "docs-site/src/content/docs/reference")
) {
  const errors = [];

  const readRef = (name) => {
    const p = path.join(refDir, name);
    if (!fs.existsSync(p)) {
      errors.push(`Missing generated reference file: ${p}`);
      return "";
    }
    return fs.readFileSync(p, "utf8");
  };

  // 1. Slash commands + shortcuts
  const cmdDoc = readRef("command-palette.mdx");
  const commands = extractCommands(repoRoot);
  const commandNames = new Set(commands.map((c) => c.name));
  for (const cmd of commands) {
    if (!cmdDoc.includes(`\`/${cmd.name}\``)) {
      errors.push(`Undocumented slash command: /${cmd.name}`);
    }
  }
  // Check for stale commands in command-palette.mdx table/headers (#### `/<name>`)
  for (const m of cmdDoc.matchAll(/^#### `\/([a-z0-9-]+)`/gm)) {
    if (!commandNames.has(m[1])) {
      errors.push(`Stale slash command documented but missing from registry: /${m[1]}`);
    }
  }

  const shortcuts = extractShortcuts(repoRoot);
  for (const sc of shortcuts) {
    if (!cmdDoc.includes(sc.label)) {
      errors.push(`Undocumented keyboard shortcut: ${sc.label}`);
    }
  }

  // 2. Permissions
  const permDoc = readRef("roles-and-permissions.mdx");
  const perms = extractPermissions(repoRoot);
  const permIds = new Set(perms.map((p) => p.id));
  for (const p of perms) {
    if (!permDoc.includes(`\`${p.id}\``)) {
      errors.push(`Undocumented permission: ${p.id}`);
    }
  }
  for (const m of permDoc.matchAll(/\|\s*`([a-z]+\.[a-z_]+)`\s*\|/g)) {
    if (!permIds.has(m[1])) {
      errors.push(`Stale permission documented but missing from code: ${m[1]}`);
    }
  }

  // 3. Env vars + system settings
  const cfgDoc = readRef("configuration.mdx");
  const envVars = extractEnvVars(repoRoot);
  const envNames = new Set(envVars.map((v) => v.name));
  for (const v of envVars) {
    if (!cfgDoc.includes(`\`${v.name}\``)) {
      errors.push(`Undocumented environment variable: ${v.name}`);
    }
  }

  const settingSections = extractSystemSettings(repoRoot);
  for (const sec of settingSections) {
    for (const f of sec.fields) {
      if (!cfgDoc.includes(`\`${f.name}\``)) {
        errors.push(`Undocumented system setting: ${sec.key}.${f.name}`);
      }
    }
  }
  // Check for stale env vars in env table
  const envSection = cfgDoc.split("## Runtime System Settings")[0] || "";
  for (const m of envSection.matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|/gm)) {
    if (!envNames.has(m[1])) {
      errors.push(`Stale environment variable documented: ${m[1]}`);
    }
  }

  // 4. Installer CLI flags
  const cliDoc = readRef("installer-cli.mdx");
  const cli = extractInstallerCli(repoRoot);
  const flagNames = new Set(cli.flags.map((f) => f.primaryFlag));
  for (const f of cli.flags) {
    if (!cliDoc.includes(f.primaryFlag)) {
      errors.push(`Undocumented installer CLI flag: ${f.primaryFlag}`);
    }
  }
  for (const m of cliDoc.matchAll(/^\|\s*`(--[a-z-]+)(?:[^`]*)`\s*\|/gm)) {
    if (!flagNames.has(m[1])) {
      errors.push(`Stale installer CLI flag documented: ${m[1]}`);
    }
  }

  // 5. Top-level API route groups
  const dbDoc = readRef("database-schema.mdx");
  const apiGroups = extractApiRouteGroups(repoRoot);
  const apiGroupSet = new Set(apiGroups);
  for (const g of apiGroups) {
    if (!dbDoc.includes(`\`/api/${g}\``)) {
      errors.push(`Undocumented top-level API route group: /api/${g}`);
    }
  }
  for (const m of dbDoc.matchAll(/^- `\/api\/([a-z0-9-]+)`/gm)) {
    if (!apiGroupSet.has(m[1])) {
      errors.push(`Stale API route group documented: /api/${m[1]}`);
    }
  }

  return errors;
}
