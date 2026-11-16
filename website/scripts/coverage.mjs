import fs from "node:fs";
import path from "node:path";
import { WEBSITE_ROOT, loadGeneratedJson } from "./lib/meta.mjs";

export function checkCoverage(
  websiteRoot = WEBSITE_ROOT,
  refDir = path.join(websiteRoot, "src/content/docs/documentation/reference")
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
  const commands = loadGeneratedJson("commands.json", websiteRoot);
  const commandNames = new Set(commands.map((c) => c.name));
  for (const cmd of commands) {
    if (!cmdDoc.includes(`\`/${cmd.name}\``)) errors.push(`Undocumented slash command: /${cmd.name}`);
  }
  for (const m of cmdDoc.matchAll(/^#### `\/([a-z0-9-]+)`/gm)) {
    if (!commandNames.has(m[1])) errors.push(`Stale slash command documented: /${m[1]}`);
  }
  for (const sc of loadGeneratedJson("shortcuts.json", websiteRoot)) {
    if (!cmdDoc.includes(sc.label)) errors.push(`Undocumented shortcut: ${sc.label}`);
  }

  // 2. Permissions
  const permDoc = readRef("roles-and-permissions.mdx");
  const perms = loadGeneratedJson("permissions.json", websiteRoot);
  const permIds = new Set(perms.map((p) => p.id));
  for (const p of perms) {
    if (!permDoc.includes(`\`${p.id}\``)) errors.push(`Undocumented permission: ${p.id}`);
  }
  for (const m of permDoc.matchAll(/\|\s*`([a-z]+\.[a-z_]+)`\s*\|/g)) {
    if (!permIds.has(m[1])) errors.push(`Stale permission documented: ${m[1]}`);
  }

  // 3. Env vars + system settings
  const cfgDoc = readRef("configuration.mdx");
  const envVars = loadGeneratedJson("env.json", websiteRoot);
  const envNames = new Set(envVars.map((v) => v.name));
  for (const v of envVars) {
    if (!cfgDoc.includes(`\`${v.name}\``)) errors.push(`Undocumented env var: ${v.name}`);
  }
  for (const sec of loadGeneratedJson("settings.json", websiteRoot)) {
    for (const f of sec.fields) {
      if (!cfgDoc.includes(`\`${f.name}\``)) errors.push(`Undocumented setting: ${sec.key}.${f.name}`);
    }
  }
  const envSection = cfgDoc.split("## Runtime System Settings")[0] || "";
  for (const m of envSection.matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|/gm)) {
    if (!envNames.has(m[1])) errors.push(`Stale env var documented: ${m[1]}`);
  }

  // 4. Installer CLI flags
  const cliDoc = readRef("installer-cli.mdx");
  const cli = loadGeneratedJson("installer-flags.json", websiteRoot);
  const flagNames = new Set((cli.flags || []).map((f) => f.primaryFlag));
  for (const f of cli.flags || []) {
    if (!cliDoc.includes(f.primaryFlag)) errors.push(`Undocumented CLI flag: ${f.primaryFlag}`);
  }
  for (const m of cliDoc.matchAll(/^\|\s*`(--[a-z-]+)(?:[^`]*)`\s*\|/gm)) {
    if (!flagNames.has(m[1])) errors.push(`Stale CLI flag documented: ${m[1]}`);
  }

  // 5. Top-level API route groups
  const dbDoc = readRef("database-schema.mdx");
  const schema = loadGeneratedJson("schema.json", websiteRoot);
  const apiGroups = schema.apiRouteGroups || [];
  const apiGroupSet = new Set(apiGroups);
  for (const g of apiGroups) {
    if (!dbDoc.includes(`\`/api/${g}\``)) errors.push(`Undocumented API route group: /api/${g}`);
  }
  for (const m of dbDoc.matchAll(/^- `\/api\/([a-z0-9-]+)`/gm)) {
    if (!apiGroupSet.has(m[1])) errors.push(`Stale API route group documented: /api/${m[1]}`);
  }

  return errors;
}
