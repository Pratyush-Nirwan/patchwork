import type { EffectiveRole } from "@/db/schema";

export type CommandCategory = "Tickets" | "Navigation" | "Workspace" | "Appearance & Help";

export type CommandArgAutocomplete =
  | "ticket"
  | "column"
  | "member"
  | "priority"
  | "label"
  | "board"
  | "view"
  | "theme"
  | "due"
  | "command"
  | "filter"
  | "docs"
  | "none";

export interface CommandArgSpec {
  name: string;
  label: string;
  usageLabel?: string;
  typeName: string;
  description: string;
  required?: boolean;
  greedyText?: boolean;
  autocomplete: CommandArgAutocomplete;
}

export interface CommandOptionSpec {
  key: string;
  typeName: string;
  description: string;
  exampleValue?: string;
  autocomplete: CommandArgAutocomplete;
}

export interface CommandDefinition {
  name: string;
  aliases: string[];
  category: CommandCategory;
  description: string;
  usage: string;
  examples: string[];
  args: CommandArgSpec[];
  options?: CommandOptionSpec[];
  minRole: EffectiveRole;
  destructive?: boolean;
  confirmLabel?: string;
  navigation?: boolean;
  undoable?: boolean;
  excludeFromHistory?: boolean;
  execution: "client" | "server";
}

export function formatUsage(
  command: Pick<CommandDefinition, "name" | "args" | "options">
): string {
  const parts: string[] = [`/${command.name}`];
  for (const arg of command.args) {
    parts.push(arg.usageLabel || arg.label);
  }
  for (const opt of command.options || []) {
    parts.push(`${opt.key}:${opt.typeName}`);
  }
  return parts.join(" ");
}

const RAW_COMMANDS: Array<Omit<CommandDefinition, "usage">> = [
  // Tickets
  {
    name: "new",
    aliases: ["create"],
    category: "Tickets",
    description: "Create a new ticket on the active board",
    examples: ["/new Fix SSE reconnect priority:high", "/new Audit login rate limit"],
    args: [
      {
        name: "title",
        label: "title",
        typeName: "text",
        description: "Type the title. Add options like priority:high after it.",
        required: true,
        greedyText: true,
        autocomplete: "none",
      },
    ],
    options: [
      {
        key: "column",
        typeName: "column",
        description: "Target column on the active board",
        exampleValue: "In Progress",
        autocomplete: "column",
      },
      {
        key: "priority",
        typeName: "level",
        description: "Ticket priority (urgent, high, medium, low)",
        exampleValue: "high",
        autocomplete: "priority",
      },
      {
        key: "assignee",
        typeName: "@user",
        description: "Assign to a team member or me",
        exampleValue: "me",
        autocomplete: "member",
      },
      {
        key: "label",
        typeName: "tag",
        description: "Comma-separated label tags",
        exampleValue: "bug",
        autocomplete: "label",
      },
    ],
    minRole: "member",
    execution: "server",
  },
  {
    name: "open",
    aliases: ["ticket"],
    category: "Tickets",
    description: "Open a ticket by key",
    examples: ["/open TELE-1"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        description: "Ticket key to open (e.g. TELE-1)",
        required: true,
        autocomplete: "ticket",
      },
    ],
    minRole: "viewer",
    navigation: true,
    execution: "client",
  },
  {
    name: "move",
    aliases: ["mv"],
    category: "Tickets",
    description: "Move a ticket to another column (enforces workflow & WIP rules)",
    examples: ['/move TELE-1 "In Progress"', "/move TELE-1 QA"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        description: "Ticket key to move",
        required: true,
        autocomplete: "ticket",
      },
      {
        name: "column",
        label: "column",
        typeName: "column",
        description: "The column to move the ticket to",
        required: true,
        autocomplete: "column",
      },
    ],
    minRole: "member",
    undoable: true,
    execution: "server",
  },
  {
    name: "assign",
    aliases: [],
    category: "Tickets",
    description: "Assign a ticket to a team member, yourself, or unassign it",
    examples: ["/assign TELE-1 me", "/assign TELE-1 unassigned"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        description: "Ticket key to assign",
        required: true,
        autocomplete: "ticket",
      },
      {
        name: "assignee",
        label: "@user",
        typeName: "member",
        description: "@name, email, me, or unassigned",
        required: true,
        autocomplete: "member",
      },
    ],
    minRole: "member",
    undoable: true,
    execution: "server",
  },
  {
    name: "priority",
    aliases: ["prio"],
    category: "Tickets",
    description: "Set ticket priority",
    examples: ["/priority TELE-1 urgent"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        description: "Ticket key to update",
        required: true,
        autocomplete: "ticket",
      },
      {
        name: "priority",
        label: "level",
        typeName: "priority",
        description: "Priority level (urgent, high, medium, low)",
        required: true,
        autocomplete: "priority",
      },
    ],
    minRole: "member",
    undoable: true,
    execution: "server",
  },
  {
    name: "label",
    aliases: [],
    category: "Tickets",
    description: "Add or remove a label on a ticket",
    examples: ["/label TELE-1 +bug", "/label TELE-1 -wip"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        description: "Ticket key to label",
        required: true,
        autocomplete: "ticket",
      },
      {
        name: "label",
        label: "tag",
        typeName: "label",
        description: "Label (+add, -remove, or name)",
        required: true,
        autocomplete: "label",
      },
    ],
    minRole: "member",
    undoable: true,
    execution: "server",
  },
  {
    name: "due",
    aliases: [],
    category: "Tickets",
    description: "Set or clear a ticket due date",
    examples: ["/due TELE-1 tomorrow", "/due TELE-1 2026-12-01", "/due TELE-1 none"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        description: "Ticket key to schedule",
        required: true,
        autocomplete: "ticket",
      },
      {
        name: "date",
        label: "date",
        typeName: "date",
        description: "YYYY-MM-DD, today, tomorrow, or none",
        required: true,
        autocomplete: "due",
      },
    ],
    minRole: "member",
    undoable: true,
    execution: "server",
  },
  {
    name: "comment",
    aliases: [],
    category: "Tickets",
    description: "Add a markdown comment to a ticket",
    examples: ['/comment TELE-1 "Verified locally on Windows"'],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        description: "Ticket key to comment on",
        required: true,
        autocomplete: "ticket",
      },
      {
        name: "text",
        label: "text",
        typeName: "markdown",
        description: "Comment body in markdown",
        required: true,
        autocomplete: "none",
      },
    ],
    minRole: "member",
    excludeFromHistory: true,
    execution: "server",
  },
  {
    name: "link",
    aliases: [],
    category: "Tickets",
    description: "Attach a GitHub or GitLab URL to a ticket",
    examples: ["/link TELE-1 https://github.com/org/repo/pull/42"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        description: "Ticket key to link",
        required: true,
        autocomplete: "ticket",
      },
      {
        name: "url",
        label: "url",
        typeName: "url",
        description: "Forge PR, issue, or commit URL",
        required: true,
        autocomplete: "none",
      },
    ],
    minRole: "member",
    execution: "server",
  },
  {
    name: "archive",
    aliases: [],
    category: "Tickets",
    description: "Archive a ticket (hides it from active boards)",
    examples: ["/archive TELE-1"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        description: "Ticket key to archive",
        required: true,
        autocomplete: "ticket",
      },
    ],
    minRole: "member",
    destructive: true,
    confirmLabel: "Archive ticket",
    excludeFromHistory: true,
    execution: "server",
  },
  {
    name: "delete",
    aliases: [],
    category: "Tickets",
    description: "Permanently delete a ticket (requires confirmation)",
    examples: ["/delete TELE-1"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        description: "Ticket key to permanently delete",
        required: true,
        autocomplete: "ticket",
      },
    ],
    minRole: "member",
    destructive: true,
    confirmLabel: "Permanently delete ticket",
    excludeFromHistory: true,
    execution: "server",
  },

  // Navigation
  {
    name: "go",
    aliases: ["board"],
    category: "Navigation",
    description: "Jump to a board, project, or team",
    examples: ["/go Core", "/go TELE"],
    args: [
      {
        name: "target",
        label: "target",
        typeName: "board",
        description: "Board, project, or team name",
        required: true,
        autocomplete: "board",
      },
    ],
    minRole: "viewer",
    navigation: true,
    execution: "client",
  },
  {
    name: "view",
    aliases: [],
    category: "Navigation",
    description: "Switch board view between Kanban and Calendar",
    examples: ["/view calendar", "/view kanban"],
    args: [
      {
        name: "mode",
        label: "mode",
        usageLabel: "kanban|calendar",
        typeName: "view",
        description: "Board layout mode (kanban or calendar)",
        required: true,
        autocomplete: "view",
      },
    ],
    minRole: "viewer",
    navigation: true,
    execution: "client",
  },
  {
    name: "filter",
    aliases: [],
    category: "Navigation",
    description: "Filter the active board by priority, assignee, label, or clear filters",
    examples: ["/filter priority:urgent", "/filter assignee:me", "/filter clear"],
    args: [
      {
        name: "expr",
        label: "expr",
        typeName: "filter",
        description: "Filter expression (priority:urgent, assignee:me, label:tag, or clear)",
        required: true,
        autocomplete: "filter",
      },
    ],
    minRole: "viewer",
    navigation: true,
    execution: "client",
  },
  {
    name: "sidebar",
    aliases: [],
    category: "Navigation",
    description: "Toggle the left workspace sidebar",
    examples: ["/sidebar"],
    args: [],
    minRole: "viewer",
    navigation: true,
    execution: "client",
  },

  // Workspace
  {
    name: "column",
    aliases: [],
    category: "Workspace",
    description: "Create a new column on the active board",
    examples: ['/column "Blocked" wip:3'],
    args: [
      {
        name: "name",
        label: "name",
        typeName: "text",
        description: "Name for the new column",
        required: true,
        autocomplete: "none",
      },
    ],
    options: [
      {
        key: "wip",
        typeName: "number",
        description: "Optional WIP limit for the column",
        exampleValue: "3",
        autocomplete: "none",
      },
    ],
    minRole: "lead",
    execution: "server",
  },
  {
    name: "members",
    aliases: [],
    category: "Workspace",
    description: "Open team members for the active team",
    examples: ["/members"],
    args: [],
    minRole: "viewer",
    navigation: true,
    execution: "client",
  },

  // Appearance & Help
  {
    name: "theme",
    aliases: [],
    category: "Appearance & Help",
    description: "Switch between light and dark theme",
    examples: ["/theme dark", "/theme toggle"],
    args: [
      {
        name: "mode",
        label: "mode",
        usageLabel: "dark|light|toggle",
        typeName: "theme",
        description: "Theme mode (dark, light, or toggle)",
        required: false,
        autocomplete: "theme",
      },
    ],
    minRole: "viewer",
    undoable: true,
    execution: "client",
  },
  {
    name: "settings",
    aliases: ["shortcuts"],
    category: "Appearance & Help",
    description: "Open user preferences and keyboard shortcut customization",
    examples: ["/settings"],
    args: [],
    minRole: "viewer",
    navigation: true,
    execution: "client",
  },
  {
    name: "system",
    aliases: [],
    category: "Appearance & Help",
    description: "Open System Configuration (admins only)",
    examples: ["/system"],
    args: [],
    minRole: "admin",
    navigation: true,
    execution: "client",
  },
  {
    name: "me",
    aliases: [],
    category: "Appearance & Help",
    description: "Show your current user profile and workspace role",
    examples: ["/me"],
    args: [],
    minRole: "viewer",
    execution: "client",
  },
  {
    name: "help",
    aliases: ["?"],
    category: "Appearance & Help",
    description: "Show available commands and shortcuts",
    examples: ["/help", "/help move"],
    args: [
      {
        name: "command",
        label: "command",
        typeName: "command",
        description: "Optional command name to inspect",
        required: false,
        autocomplete: "command",
      },
    ],
    minRole: "viewer",
    navigation: true,
    execution: "client",
  },
  {
    name: "docs",
    aliases: ["doc", "manual"],
    category: "Appearance & Help",
    description: "Open Patchwork documentation",
    examples: ["/docs", "/docs command-palette", "/docs troubleshooting"],
    args: [
      {
        name: "topic",
        label: "topic",
        typeName: "topic",
        description: "Optional documentation topic",
        required: false,
        autocomplete: "docs",
      },
    ],
    minRole: "viewer",
    navigation: true,
    execution: "client",
  },
  {
    name: "logout",
    aliases: ["signout"],
    category: "Appearance & Help",
    description: "Sign out of Patchwork",
    examples: ["/logout"],
    args: [],
    minRole: "viewer",
    destructive: true,
    confirmLabel: "Sign out of your session",
    navigation: true,
    excludeFromHistory: true,
    execution: "client",
  },
];

export const COMMAND_REGISTRY: CommandDefinition[] = RAW_COMMANDS.map((cmd) => ({
  ...cmd,
  usage: formatUsage(cmd),
}));

const ROLE_RANK: Record<EffectiveRole, number> = {
  viewer: 1,
  member: 2,
  lead: 3,
  admin: 4,
};

export function findCommandDefinition(nameOrAlias: string): CommandDefinition | undefined {
  const normalized = nameOrAlias.trim().toLowerCase().replace(/^\//, "");
  if (!normalized) return undefined;
  return COMMAND_REGISTRY.find(
    (cmd) => cmd.name === normalized || cmd.aliases.includes(normalized)
  );
}

export function isRoleAllowedForCommand(
  userRole: EffectiveRole | null | undefined,
  minRole: EffectiveRole
): boolean {
  const effective: EffectiveRole = userRole || "viewer";
  return ROLE_RANK[effective] >= ROLE_RANK[minRole];
}

export function filterCommandsByQuery(
  query: string,
  userRole?: EffectiveRole | null
): CommandDefinition[] {
  const q = query.trim().toLowerCase().replace(/^\//, "");
  return COMMAND_REGISTRY.filter((cmd) => {
    const roleOk = !userRole || isRoleAllowedForCommand(userRole, cmd.minRole);
    if (!roleOk) return false;
    if (!q) return true;
    return (
      cmd.name.includes(q) ||
      cmd.aliases.some((a) => a.includes(q)) ||
      cmd.description.toLowerCase().includes(q) ||
      cmd.category.toLowerCase().includes(q)
    );
  });
}
