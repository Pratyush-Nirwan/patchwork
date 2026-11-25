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

export type CommandArgInputType = "word" | "text" | "choice";

export interface CommandArgSpec {
  name: string;
  label: string;
  usageLabel?: string;
  typeName: string;
  argType: CommandArgInputType;
  description: string;
  required?: boolean;
  greedyText?: boolean;
  autocomplete: CommandArgAutocomplete;
}

export interface CommandOptionSpec {
  key: string;
  typeName: string;
  argType: CommandArgInputType;
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
    parts.push(`${arg.label}: ${arg.usageLabel || arg.typeName}`);
  }
  for (const opt of command.options || []) {
    parts.push(`${opt.key}: ${opt.typeName}`);
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
    examples: ["/new title: Fix SSE reconnect priority: high", "/new title: Audit login rate limit"],
    args: [
      {
        name: "title",
        label: "title",
        typeName: "ticket title",
        argType: "text",
        description: "Type the title. Add options like priority: high after it.",
        required: true,
        greedyText: true,
        autocomplete: "none",
      },
    ],
    options: [
      {
        key: "column",
        typeName: "column",
        argType: "choice",
        description: "Target column on the active board",
        exampleValue: "In Progress",
        autocomplete: "column",
      },
      {
        key: "priority",
        typeName: "level",
        argType: "choice",
        description: "Ticket priority (urgent, high, medium, low)",
        exampleValue: "high",
        autocomplete: "priority",
      },
      {
        key: "assignee",
        typeName: "@user",
        argType: "word",
        description: "Assign to a team member or me",
        exampleValue: "me",
        autocomplete: "member",
      },
      {
        key: "label",
        typeName: "tag",
        argType: "word",
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
    examples: ["/open ticket: TELE-1"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        argType: "word",
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
    examples: ["/move ticket: TELE-1 column: In Progress", "/move ticket: TELE-1 column: QA"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        argType: "word",
        description: "Ticket key to move",
        required: true,
        autocomplete: "ticket",
      },
      {
        name: "column",
        label: "column",
        typeName: "column",
        argType: "choice",
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
    examples: ["/assign ticket: TELE-1 @user: me", "/assign ticket: TELE-1 @user: unassigned"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        argType: "word",
        description: "Ticket key to assign",
        required: true,
        autocomplete: "ticket",
      },
      {
        name: "assignee",
        label: "@user",
        typeName: "member",
        argType: "word",
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
    examples: ["/priority ticket: TELE-1 level: urgent"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        argType: "word",
        description: "Ticket key to update",
        required: true,
        autocomplete: "ticket",
      },
      {
        name: "priority",
        label: "level",
        typeName: "priority",
        argType: "choice",
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
    examples: ["/label ticket: TELE-1 tag: +bug", "/label ticket: TELE-1 tag: -wip"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        argType: "word",
        description: "Ticket key to label",
        required: true,
        autocomplete: "ticket",
      },
      {
        name: "label",
        label: "tag",
        typeName: "label",
        argType: "word",
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
    examples: ["/due ticket: TELE-1 date: tomorrow", "/due ticket: TELE-1 date: 2026-12-01", "/due ticket: TELE-1 date: none"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        argType: "word",
        description: "Ticket key to schedule",
        required: true,
        autocomplete: "ticket",
      },
      {
        name: "date",
        label: "date",
        typeName: "date",
        argType: "word",
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
    examples: ["/comment ticket: TELE-1 text: Verified locally on Windows"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        argType: "word",
        description: "Ticket key to comment on",
        required: true,
        autocomplete: "ticket",
      },
      {
        name: "text",
        label: "text",
        typeName: "markdown",
        argType: "text",
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
    examples: ["/link ticket: TELE-1 url: https://github.com/org/repo/pull/42"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        argType: "word",
        description: "Ticket key to link",
        required: true,
        autocomplete: "ticket",
      },
      {
        name: "url",
        label: "url",
        typeName: "url",
        argType: "word",
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
    examples: ["/archive ticket: TELE-1"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        argType: "word",
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
    examples: ["/delete ticket: TELE-1"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        argType: "word",
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
    examples: ["/go target: Core", "/go target: TELE"],
    args: [
      {
        name: "target",
        label: "target",
        typeName: "board",
        argType: "choice",
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
    examples: ["/view mode: calendar", "/view mode: kanban"],
    args: [
      {
        name: "mode",
        label: "mode",
        usageLabel: "kanban|calendar",
        typeName: "view",
        argType: "choice",
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
    examples: ["/filter expr: priority:urgent", "/filter expr: assignee:me", "/filter expr: clear"],
    args: [
      {
        name: "expr",
        label: "expr",
        typeName: "filter",
        argType: "word",
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
    examples: ["/column name: Blocked wip: 3"],
    args: [
      {
        name: "name",
        label: "name",
        typeName: "text",
        argType: "text",
        description: "Name for the new column",
        required: true,
        autocomplete: "none",
      },
    ],
    options: [
      {
        key: "wip",
        typeName: "number",
        argType: "word",
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
    examples: ["/theme mode: dark", "/theme mode: toggle"],
    args: [
      {
        name: "mode",
        label: "mode",
        usageLabel: "dark|light|toggle",
        typeName: "theme",
        argType: "choice",
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
    examples: ["/help", "/help command: move"],
    args: [
      {
        name: "command",
        label: "command",
        typeName: "command",
        argType: "choice",
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
    examples: ["/docs", "/docs topic: command-palette", "/docs topic: troubleshooting"],
    args: [
      {
        name: "topic",
        label: "topic",
        typeName: "topic",
        argType: "choice",
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
  {
    name: "watch",
    aliases: ["follow"],
    category: "Tickets",
    description: "Watch a ticket for updates (defaults to open ticket)",
    examples: ["/watch", "/watch ticket: TELE-1"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        argType: "word",
        description: "Optional ticket key (defaults to currently open ticket)",
        required: false,
        autocomplete: "ticket",
      },
    ],
    minRole: "viewer",
    execution: "server",
  },
  {
    name: "unwatch",
    aliases: ["unfollow"],
    category: "Tickets",
    description: "Stop watching a ticket (defaults to open ticket)",
    examples: ["/unwatch", "/unwatch ticket: TELE-1"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        argType: "word",
        description: "Optional ticket key (defaults to currently open ticket)",
        required: false,
        autocomplete: "ticket",
      },
    ],
    minRole: "viewer",
    execution: "server",
  },
  {
    name: "mute",
    aliases: [],
    category: "Tickets",
    description: "Mute or unmute watched-ticket notifications (defaults to open ticket)",
    examples: ["/mute", "/mute ticket: TELE-1"],
    args: [
      {
        name: "key",
        label: "ticket",
        typeName: "key",
        argType: "word",
        description: "Optional ticket key (defaults to currently open ticket)",
        required: false,
        autocomplete: "ticket",
      },
    ],
    minRole: "viewer",
    execution: "server",
  },
  {
    name: "notifications",
    aliases: ["inbox"],
    category: "Navigation",
    description: "Open your notifications inbox",
    examples: ["/notifications"],
    args: [],
    minRole: "viewer",
    navigation: true,
    execution: "client",
  },
  {
    name: "read-all",
    aliases: ["mark-all-read"],
    category: "Workspace",
    description: "Mark all unread notifications as read",
    examples: ["/read-all"],
    args: [],
    minRole: "viewer",
    execution: "server",
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
