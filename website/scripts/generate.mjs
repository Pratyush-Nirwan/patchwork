import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WEBSITE_ROOT, loadGeneratedJson } from "./lib/meta.mjs";
import { generateRoadmapDocs } from "./roadmap.mjs";
import { generateChangelogDocs } from "./changelog.mjs";

const GENERATED_HEADER =
  "{/* Generated file, do not edit. Run `npm run generate` to update. */}";

function mdxEscape(val) {
  return String(val ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/(https?:\/\/[a-zA-Z0-9.:_-]+)/g, "`$1`");
}

function writeLf(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const normalized = content.replace(/\r\n/g, "\n");
  fs.writeFileSync(filePath, normalized.endsWith("\n") ? normalized : `${normalized}\n`, "utf8");
}

function renderCommandPalettePage(commands, shortcuts) {
  const categories = new Map();
  for (const cmd of commands) {
    const list = categories.get(cmd.category) || [];
    list.push(cmd);
    categories.set(cmd.category, list);
  }

  const lines = [
    "---",
    'title: "Command Palette & Shortcuts Reference"',
    'description: "Generated reference of all Patchwork slash commands, keyboard shortcuts, and filter tokens."',
    "---",
    "",
    GENERATED_HEADER,
    "",
    "This reference is generated from `src/data/generated/commands.json` and `shortcuts.json`.",
    "",
    "## Keyboard Shortcuts",
    "",
    "| Action | Default Shortcut (Win/Linux) | Default Shortcut (macOS) | Description |",
    "| --- | --- | --- | --- |",
  ];

  for (const sc of shortcuts) {
    const winLinux = sc.defaultCombo.replace(/^mod\+/i, "Ctrl+");
    const mac = sc.defaultCombo.replace(/^mod\+/i, "Cmd+");
    lines.push(
      `| ${mdxEscape(sc.label)} | \`${winLinux}\` | \`${mac}\` | ${mdxEscape(sc.description)} |`
    );
  }

  lines.push("", "## Slash Commands", "");

  for (const [category, cmds] of categories.entries()) {
    lines.push(`### ${category}`, "");
    lines.push("| Command | Usage | Min Role | Flags | Description |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const cmd of cmds) {
      const flags = [
        cmd.destructive ? "destructive" : null,
        cmd.undoable ? "undoable" : null,
        cmd.excludeFromHistory ? "no-history" : null,
      ]
        .filter(Boolean)
        .join(", ") || "—";
      lines.push(
        `| \`/${cmd.name}\` | \`${cmd.usage}\` | \`${cmd.minRole}\` | ${flags} | ${mdxEscape(cmd.description)} |`
      );
    }
    lines.push("");

    for (const cmd of cmds) {
      lines.push(`#### \`/${cmd.name}\``, "");
      lines.push(`- **Usage:** \`${cmd.usage}\``);
      lines.push(`- **Minimum role:** \`${cmd.minRole}\``);
      if (cmd.aliases && cmd.aliases.length > 0) {
        lines.push(`- **Aliases:** ${cmd.aliases.map((a) => `\`/${a}\``).join(", ")}`);
      }
      if (cmd.args && cmd.args.length > 0) {
        lines.push("- **Arguments:**");
        for (const arg of cmd.args) {
          lines.push(
            `  - \`${arg.label}\` (${arg.typeName}, ${arg.required ? "required" : "optional"}): ${mdxEscape(arg.description)}`
          );
        }
      }
      if (cmd.options && cmd.options.length > 0) {
        lines.push("- **Options:**");
        for (const opt of cmd.options) {
          lines.push(
            `  - \`${opt.key}:${opt.typeName}\` (example: \`${opt.exampleValue}\`): ${mdxEscape(opt.description)}`
          );
        }
      }
      if (cmd.examples && cmd.examples.length > 0) {
        lines.push("- **Examples:** " + cmd.examples.map((ex) => `\`${ex}\``).join(", "));
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function renderPermissionsPage(permissions) {
  const lines = [
    "---",
    'title: "Roles & Permissions Matrix"',
    'description: "Generated matrix of Patchwork organization and team roles against workspace actions."',
    "---",
    "",
    GENERATED_HEADER,
    "",
    "This matrix is generated from `src/data/generated/permissions.json`. All checks are enforced server-side.",
    "",
    "Note: Organization `admin` inherits full access across all teams. Within a team, `member` accounts can also hold an optional `developer` or `tester` sub-role for workflow transitions.",
    "",
    "| Category | Permission | ID | Admin | Team Lead | Member | Viewer | Description |",
    "| --- | --- | --- | :---: | :---: | :---: | :---: | --- |",
  ];

  for (const perm of permissions) {
    const has = (r) => (perm.allowedRoles.includes(r) ? "Yes" : "—");
    lines.push(
      `| ${mdxEscape(perm.category)} | ${mdxEscape(perm.action)} | \`${perm.id}\` | ${has("admin")} | ${has("lead")} | ${has("member")} | ${has("viewer")} | ${mdxEscape(perm.description)} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

function renderConfigurationPage(envVars, settingSections) {
  const lines = [
    "---",
    'title: "Configuration & Settings Reference"',
    'description: "Generated reference for Patchwork environment variables and runtime system settings."',
    "---",
    "",
    GENERATED_HEADER,
    "",
    "Generated from `src/data/generated/env.json` and `settings.json`.",
    "",
    "## Environment Variables",
    "",
    "| Variable | Default / Example | Required | Secret | Purpose |",
    "| --- | --- | :---: | :---: | --- |",
  ];

  for (const v of envVars) {
    const shownDefault = v.secret && v.defaultValue !== "(empty)" ? "`<set-in-env>`" : `\`${v.defaultValue}\``;
    lines.push(
      `| \`${v.name}\` | ${shownDefault} | ${v.required ? "Yes" : "No"} | ${v.secret ? "Yes" : "No"} | ${mdxEscape(v.purpose)} |`
    );
  }

  lines.push("", "## Runtime System Settings (System Configuration)", "");
  lines.push(
    "Admins configure these settings in **System Configuration** (`/dashboard/system`). Values are validated by Zod schemas and persisted in the `system_settings` table."
  );
  lines.push("");

  for (const sec of settingSections) {
    lines.push(`### ${sec.title} (\`${sec.key}\`)`, "");
    lines.push("| Setting | Type | Allowed Range / Values | Default |");
    lines.push("| --- | --- | --- | --- |");
    for (const f of sec.fields) {
      lines.push(
        `| \`${f.name}\` | \`${mdxEscape(f.type)}\` | ${mdxEscape(f.range)} | \`${mdxEscape(f.defaultValue)}\` |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderDatabaseSchemaPage(tables, apiGroups) {
  const lines = [
    "---",
    'title: "Database Schema & API Route Groups"',
    'description: "Generated reference of PostgreSQL tables, columns, foreign keys, and top-level API route groups."',
    "---",
    "",
    GENERATED_HEADER,
    "",
    "Generated from `src/data/generated/schema.json`.",
    "",
    "## Top-Level API Route Groups",
    "",
    apiGroups.map((g) => `- \`/api/${g}\``).join("\n"),
    "",
    "## PostgreSQL Tables",
    "",
  ];

  for (const tbl of tables) {
    lines.push(`### \`${tbl.tableName}\``, "");
    lines.push("| Column | Drizzle Type | Nullable | Constraints / References |");
    lines.push("| --- | --- | :---: | --- |");
    for (const col of tbl.columns) {
      const constraints = [
        col.primaryKey ? "PRIMARY KEY" : null,
        col.unique ? "UNIQUE" : null,
        col.references ? `REFERENCES ${col.references}` : null,
      ]
        .filter(Boolean)
        .join(", ") || "—";
      lines.push(
        `| \`${col.colName}\` | \`${col.colType}\` | ${col.nullable ? "Yes" : "No"} | ${mdxEscape(constraints)} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderInstallerCliPage(cli) {
  const lines = [
    "---",
    'title: "Installer CLI Reference"',
    'description: "Generated reference for scripts/setup.mjs CLI flags and non-interactive modes."',
    "---",
    "",
    GENERATED_HEADER,
    "",
    "Generated from `src/data/generated/installer-flags.json`.",
    "",
    "## Usage",
    "",
    "```bash",
    "npm run setup [-- [options]]",
    "node scripts/setup.mjs [options]",
    "```",
    "",
    "## CLI Flags",
    "",
    "| Flag | Description |",
    "| --- | --- |",
  ];

  for (const f of cli.flags) {
    lines.push(`| \`${f.flag}\` | ${mdxEscape(f.description)} |`);
  }

  lines.push("", "## Existing Installation Actions (`--action=<mode>`)", "");
  lines.push("| Action | Behavior |");
  lines.push("| --- | --- |");
  for (const act of cli.actions) {
    lines.push(`| \`${act.action}\` | ${mdxEscape(act.description)} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export function generateReferenceDocs(
  websiteRoot = WEBSITE_ROOT,
  outputDir = path.join(websiteRoot, "src/content/docs/documentation/reference")
) {
  const commands = loadGeneratedJson("commands.json", websiteRoot);
  const shortcuts = loadGeneratedJson("shortcuts.json", websiteRoot);
  const permissions = loadGeneratedJson("permissions.json", websiteRoot);
  const envVars = loadGeneratedJson("env.json", websiteRoot);
  const settingSections = loadGeneratedJson("settings.json", websiteRoot);
  const schema = loadGeneratedJson("schema.json", websiteRoot);
  const cli = loadGeneratedJson("installer-flags.json", websiteRoot);

  const outputs = new Map([
    ["command-palette.mdx", renderCommandPalettePage(commands, shortcuts)],
    ["roles-and-permissions.mdx", renderPermissionsPage(permissions)],
    ["configuration.mdx", renderConfigurationPage(envVars, settingSections)],
    ["database-schema.mdx", renderDatabaseSchemaPage(schema.tables || [], schema.apiRouteGroups || [])],
    ["installer-cli.mdx", renderInstallerCliPage(cli)],
  ]);

  for (const [filename, content] of outputs.entries()) {
    writeLf(path.join(outputDir, filename), content);
  }

  return Array.from(outputs.keys());
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const refFiles = generateReferenceDocs(WEBSITE_ROOT);
  const roadmapFiles = generateRoadmapDocs(WEBSITE_ROOT);
  const changelogFiles = generateChangelogDocs(WEBSITE_ROOT);
  console.log(
    `Generated ${refFiles.length} reference pages, ${roadmapFiles.length} roadmap targets, and ${changelogFiles.length} changelog pages.`
  );
}
