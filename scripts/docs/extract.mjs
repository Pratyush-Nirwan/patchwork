import fs from "node:fs";
import path from "node:path";

export function findRepoRoot(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "src"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error("Could not locate repository root");
    }
    dir = parent;
  }
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function stripLineComments(code) {
  let out = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let escape = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1];
    if (escape) {
      out += ch;
      escape = false;
      continue;
    }
    if ((inSingle || inDouble || inBacktick) && ch === "\\") {
      out += ch;
      escape = true;
      continue;
    }
    if (!inDouble && !inBacktick && ch === "'") {
      inSingle = !inSingle;
      out += ch;
      continue;
    }
    if (!inSingle && !inBacktick && ch === '"') {
      inDouble = !inDouble;
      out += ch;
      continue;
    }
    if (!inSingle && !inDouble && ch === "`") {
      inBacktick = !inBacktick;
      out += ch;
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick && ch === "/" && next === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick && ch === "/" && next === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function extractBalanced(text, openIdx, openChar = "[", closeChar = "]") {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let escape = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if ((inSingle || inDouble || inBacktick) && ch === "\\") {
      escape = true;
      continue;
    }
    if (!inDouble && !inBacktick && ch === "'") inSingle = !inSingle;
    else if (!inSingle && !inBacktick && ch === '"') inDouble = !inDouble;
    else if (!inSingle && !inDouble && ch === "`") inBacktick = !inBacktick;
    else if (!inSingle && !inDouble && !inBacktick) {
      if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) return text.slice(openIdx, i + 1);
      }
    }
  }
  throw new Error(`Unbalanced ${openChar}${closeChar} starting at ${openIdx}`);
}

export function formatCommandUsage(cmd) {
  const parts = [`/${cmd.name}`];
  for (const arg of cmd.args || []) {
    parts.push(arg.usageLabel || arg.label || arg.name);
  }
  for (const opt of cmd.options || []) {
    parts.push(`${opt.key}:${opt.typeName}`);
  }
  return parts.join(" ");
}

function extractArrayLiteral(raw, marker) {
  const markerIdx = raw.indexOf(marker);
  if (markerIdx === -1) throw new Error(`${marker} not found`);
  const eqBracketIdx = raw.indexOf("= [", markerIdx);
  if (eqBracketIdx === -1) throw new Error(`Array initializer for ${marker} not found`);
  const bracketIdx = eqBracketIdx + 2;
  const arrayLiteral = stripLineComments(extractBalanced(raw, bracketIdx, "[", "]"));
  return new Function(`return (${arrayLiteral});`)();
}

export function extractCommands(repoRoot) {
  const filePath = path.join(repoRoot, "src/lib/commands/registry.ts");
  const raw = readUtf8(filePath);
  const commands = extractArrayLiteral(raw, "const RAW_COMMANDS");
  return commands.map((cmd) => ({
    ...cmd,
    usage: formatCommandUsage(cmd),
  }));
}

export function extractShortcuts(repoRoot) {
  const filePath = path.join(repoRoot, "src/lib/shortcuts.ts");
  const raw = readUtf8(filePath);
  return extractArrayLiteral(raw, "export const SHORTCUT_DEFINITIONS");
}

export function extractPermissions(repoRoot) {
  const filePath = path.join(repoRoot, "src/lib/rbac.ts");
  const raw = readUtf8(filePath);
  return extractArrayLiteral(raw, "export const PERMISSIONS_MATRIX");
}

export function extractEnvVars(repoRoot) {
  const filePath = path.join(repoRoot, ".env.example");
  const lines = readUtf8(filePath).split(/\r?\n/);
  const secretKeys = new Set([
    "SESSION_SECRET",
    "CSRF_SECRET",
    "TOKEN_ENCRYPTION_KEY",
    "S3_SECRET_KEY",
    "GITHUB_TOKEN",
    "GITLAB_TOKEN",
  ]);
  const optionalKeys = new Set(["GITHUB_TOKEN", "GITLAB_TOKEN"]);

  const vars = [];
  let comments = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      comments = [];
      continue;
    }
    if (trimmed.startsWith("#")) {
      comments.push(trimmed.replace(/^#\s?/, ""));
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const name = trimmed.slice(0, eqIdx).trim();
      const defaultValue = trimmed.slice(eqIdx + 1).trim();
      vars.push({
        name,
        defaultValue: defaultValue || "(empty)",
        purpose: comments.join(" ") || `Configuration variable ${name}`,
        required: !optionalKeys.has(name),
        secret: secretKeys.has(name) || name === "DATABASE_URL",
      });
      comments = [];
    }
  }
  return vars;
}

export function extractSystemSettings(repoRoot) {
  const filePath = path.join(repoRoot, "src/lib/settings.ts");
  const raw = readUtf8(filePath);
  const sectionSchemas = [
    { key: "security", schemaName: "SecuritySettingsSchema", title: "Security & Sessions" },
    { key: "storage", schemaName: "StorageSettingsSchema", title: "Storage & Files" },
    { key: "integrations", schemaName: "IntegrationsSettingsSchema", title: "Integrations" },
    { key: "appearance", schemaName: "AppearanceSettingsSchema", title: "Appearance & Defaults" },
  ];

  const sections = [];
  for (const sec of sectionSchemas) {
    const idx = raw.indexOf(`export const ${sec.schemaName} = z.object(`);
    if (idx === -1) continue;
    const braceIdx = raw.indexOf("{", idx);
    const body = extractBalanced(raw, braceIdx, "{", "}");
    const inner = body.slice(1, -1);

    // Split top-level properties by comma at depth 0
    const props = [];
    let start = 0;
    let dParen = 0;
    let dBracket = 0;
    let dBrace = 0;
    let inStr = null;
    let esc = false;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (inStr && ch === "\\") {
        esc = true;
        continue;
      }
      if (!inStr && (ch === '"' || ch === "'" || ch === "`")) inStr = ch;
      else if (inStr === ch) inStr = null;
      else if (!inStr) {
        if (ch === "(") dParen++;
        else if (ch === ")") dParen--;
        else if (ch === "[") dBracket++;
        else if (ch === "]") dBracket--;
        else if (ch === "{") dBrace++;
        else if (ch === "}") dBrace--;
        else if (ch === "," && dParen === 0 && dBracket === 0 && dBrace === 0) {
          props.push(inner.slice(start, i).trim());
          start = i + 1;
        }
      }
    }
    if (inner.slice(start).trim()) props.push(inner.slice(start).trim());

    const fields = [];
    for (const prop of props) {
      const cleanProp = stripLineComments(prop).trim();
      const colonIdx = cleanProp.indexOf(":");
      if (colonIdx === -1) continue;
      const name = cleanProp.slice(0, colonIdx).trim();
      const expr = cleanProp.slice(colonIdx + 1).trim();

      const minMatch = expr.match(/\.min\(([^)]+)\)/);
      const maxMatch = expr.match(/\.max\(([^)]+)\)/);
      const enumMatch = expr.match(/z\.enum\(\s*(\[[^\]]+\])\s*\)/);
      const defaultIdx = expr.lastIndexOf(".default(");
      let defaultVal = "—";
      if (defaultIdx !== -1) {
        const parenStr = extractBalanced(expr, defaultIdx + ".default".length, "(", ")");
        defaultVal = parenStr.slice(1, -1).replace(/\s+/g, " ").trim();
      }
      let type = "string";
      if (expr.includes("z.number()")) type = "integer";
      else if (expr.includes("z.boolean()")) type = "boolean";
      else if (expr.includes("z.array(")) type = "array";
      else if (enumMatch) type = `enum ${enumMatch[1].replace(/\s+/g, " ")}`;
      else if (expr.includes(".nullable()")) type = "string | null";

      let range = "—";
      if (minMatch && maxMatch) range = `${minMatch[1]} .. ${maxMatch[1]}`;
      else if (minMatch) range = `>= ${minMatch[1]}`;
      else if (maxMatch) range = `<= ${maxMatch[1]}`;
      else if (enumMatch) range = enumMatch[1].replace(/\s+/g, " ");
      else if (name === "sessionIdleTimeoutMs") range = "0 (disabled) or 60000 .. 2592000000";

      fields.push({ name, type, range, defaultValue: defaultVal });
    }
    sections.push({ ...sec, fields });
  }

  return sections;
}

export function extractDatabaseSchema(repoRoot) {
  const filePath = path.join(repoRoot, "src/db/schema.ts");
  const raw = stripLineComments(readUtf8(filePath));
  const tables = [];
  const tableRegex = /export const (\w+)\s*=\s*pgTable\s*\(\s*["']([^"']+)["']\s*,\s*\{/g;
  let match;
  while ((match = tableRegex.exec(raw)) !== null) {
    const varName = match[1];
    const tableName = match[2];
    const braceStart = raw.indexOf("{", match.index + "export const ".length);
    const body = extractBalanced(raw, braceStart, "{", "}");
    const inner = body.slice(1, -1);

    const cols = [];
    let start = 0;
    let dParen = 0;
    let dBrace = 0;
    let dBracket = 0;
    let inStr = null;
    let esc = false;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (inStr && ch === "\\") {
        esc = true;
        continue;
      }
      if (!inStr && (ch === '"' || ch === "'" || ch === "`")) inStr = ch;
      else if (inStr === ch) inStr = null;
      else if (!inStr) {
        if (ch === "(") dParen++;
        else if (ch === ")") dParen--;
        else if (ch === "{") dBrace++;
        else if (ch === "}") dBrace--;
        else if (ch === "[") dBracket++;
        else if (ch === "]") dBracket--;
        else if (ch === "," && dParen === 0 && dBrace === 0 && dBracket === 0) {
          cols.push(inner.slice(start, i).trim());
          start = i + 1;
        }
      }
    }
    if (inner.slice(start).trim()) cols.push(inner.slice(start).trim());

    const columns = [];
    for (const col of cols) {
      const colonIdx = col.indexOf(":");
      if (colonIdx === -1) continue;
      const propName = col.slice(0, colonIdx).trim();
      const expr = col.slice(colonIdx + 1).trim();
      const typeMatch = expr.match(/^(\w+)\(\s*["']([^"']+)["']/);
      const colName = typeMatch ? typeMatch[2] : propName;
      const colType = typeMatch ? typeMatch[1] : "unknown";
      const notNull = expr.includes(".notNull()") || expr.includes(".primaryKey()");
      const pk = expr.includes(".primaryKey()");
      const unique = expr.includes(".unique()");
      const refMatch = expr.match(/\.references\(\s*\(\)\s*=>\s*([a-zA-Z0-9_.]+)/);
      columns.push({
        propName,
        colName,
        colType,
        nullable: !notNull,
        primaryKey: pk,
        unique,
        references: refMatch ? refMatch[1] : null,
      });
    }
    tables.push({ varName, tableName, columns });
  }
  return tables;
}

export function extractInstallerCli(repoRoot) {
  const filePath = path.join(repoRoot, "scripts/setup.mjs");
  const raw = readUtf8(filePath);
  const helpMatch = raw.match(/export function printHelp[\s\S]*?write\(`([\s\S]*?)`\);/);
  const flags = [];
  if (helpMatch) {
    const lines = helpMatch[1].split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s{2}(--[a-zA-Z0-9-=<>]+(?:,\s*-[a-zA-Z])?)\s{2,}(.+)$/);
      if (m) {
        flags.push({
          flag: m[1].trim(),
          primaryFlag: m[1].split(",")[0].split("=")[0].trim(),
          description: m[2].trim(),
        });
      }
    }
  }
  return {
    flags,
    actions: [
      { action: "repair", description: "Re-verify PostgreSQL, MinIO, .env, and systemd/service configuration without deleting data" },
      { action: "reset", description: "Destructive reset: drop database, clear MinIO data, and remove generated config after confirmation" },
      { action: "status", description: "Print detected installation state table and exit" },
    ],
  };
}

export function extractApiRouteGroups(repoRoot) {
  const apiDir = path.join(repoRoot, "src/app/api");
  if (!fs.existsSync(apiDir)) return [];
  return fs
    .readdirSync(apiDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}
