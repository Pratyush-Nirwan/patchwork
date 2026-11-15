import {
  pgTable,
  uuid,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    isSetupAdmin: boolean("is_setup_admin").notNull().default(false),
    isDeactivated: boolean("is_deactivated").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_lower_email_idx").on(sql`lower(${table.email})`),
  ]
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    csrfToken: text("csrf_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)]
);

export const orgs = pgTable("orgs", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull().default(""),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export interface SetupDraftTeam {
  id?: string;
  name: string;
  slug?: string;
  description?: string;
  leadEmail?: string;
}

export interface SetupDraftEmployee {
  id?: string;
  userId?: string;
  name: string;
  email: string;
  role: "admin" | "lead" | "member" | "viewer";
  teamSlug?: string;
  projects?: string[];
  roleNotes?: string;
  temporaryPassword?: string;
}

export interface SetupDraftProject {
  id?: string;
  teamSlug: string;
  name: string;
  key: string;
  description?: string;
}

export interface SetupDraftColumn {
  id?: string;
  name: string;
  wipLimit?: number | null;
  color?: string;
}

export interface SetupDraftBoard {
  id?: string;
  projectKey: string;
  name: string;
  description?: string;
  columns: SetupDraftColumn[];
}

export interface SetupDraftData {
  admin?: {
    name?: string;
    email?: string;
  };
  org?: {
    name?: string;
    slug?: string;
    description?: string;
  };
  teams?: SetupDraftTeam[];
  employees?: SetupDraftEmployee[];
  employeeVisibleColumns?: string[];
  projects?: SetupDraftProject[];
  boards?: SetupDraftBoard[];
}

export const setupState = pgTable("setup_state", {
  id: text("id").primaryKey().default("default"),
  adminUserId: uuid("admin_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  orgId: uuid("org_id").references(() => orgs.id, {
    onDelete: "set null",
  }),
  currentStep: integer("current_step").notNull().default(1),
  completedSteps: jsonb("completed_steps").$type<number[]>().notNull().default([]),
  skippedSteps: jsonb("skipped_steps").$type<number[]>().notNull().default([]),
  draftData: jsonb("draft_data").$type<SetupDraftData>().notNull().default({}),
  isCompleted: boolean("is_completed").notNull().default(false),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const setupToken = pgTable("setup_token", {
  id: text("id").primaryKey().default("default"),
  ciphertext: text("ciphertext"),
  iv: text("iv"),
  authTag: text("auth_tag"),
  keyVersion: integer("key_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

export const setupCredentials = pgTable("setup_credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type OrgRole = "admin" | "member";
export type TeamRole = "lead" | "member" | "viewer";
export type MemberSubRole = "developer" | "tester";
export type EffectiveRole = "admin" | "lead" | "member" | "viewer";
export type TicketPriority = "urgent" | "high" | "medium" | "low" | "none";

export const orgMembers = pgTable(
  "org_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<OrgRole>().notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("org_members_org_user_uidx").on(table.orgId, table.userId)]
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("teams_org_slug_uidx").on(table.orgId, table.slug)]
);

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<TeamRole>().notNull().default("member"),
    subRole: text("sub_role").$type<MemberSubRole>().default("developer"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("team_members_team_user_uidx").on(table.teamId, table.userId)]
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    key: text("key").notNull(),
    description: text("description").notNull().default(""),
    ticketCounter: integer("ticket_counter").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("projects_team_key_uidx").on(table.teamId, table.key)]
);

export const boards = pgTable(
  "boards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("boards_project_id_idx").on(table.projectId)]
);

export const columns = pgTable(
  "columns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: doublePrecision("position").notNull().default(0),
    wipLimit: integer("wip_limit"),
    color: text("color").notNull().default("#64748B"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("columns_board_pos_idx").on(table.boardId, table.position)]
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    columnId: uuid("column_id")
      .notNull()
      .references(() => columns.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    priority: text("priority").$type<TicketPriority>().notNull().default("medium"),
    labels: text("labels")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    labelsText: text("labels_text").notNull().default(""),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(key, '')), 'A') || setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B') || setweight(to_tsvector('english', coalesce(labels_text, '')), 'C')`
    ),
  },
  (table) => [
    index("tickets_board_col_pos_idx").on(table.boardId, table.columnId, table.position),
    index("tickets_team_id_idx").on(table.teamId),
    index("tickets_search_idx").using("gin", table.searchVector),
  ]
);

export const ticketComments = pgTable(
  "ticket_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(body, ''))`
    ),
  },
  (table) => [
    index("ticket_comments_ticket_idx").on(table.ticketId),
    index("ticket_comments_search_idx").using("gin", table.searchVector),
  ]
);

export const ticketActivities = pgTable(
  "ticket_activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("ticket_activities_ticket_idx").on(table.ticketId, table.createdAt)]
);

export const ticketAttachments = pgTable(
  "ticket_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    extractedText: text("extracted_text").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(filename, '')), 'A') || setweight(to_tsvector('english', coalesce(extracted_text, '')), 'B')`
    ),
  },
  (table) => [
    index("ticket_attachments_ticket_idx").on(table.ticketId),
    index("ticket_attachments_search_idx").using("gin", table.searchVector),
  ]
);

export const ticketLinks = pgTable(
  "ticket_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<"github" | "gitlab">().notNull(),
    kind: text("kind").$type<"pr" | "mr" | "issue" | "commit">().notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull(),
    externalRef: text("external_ref").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("ticket_links_ticket_idx").on(table.ticketId)]
);

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  orgMemberships: many(orgMembers),
  teamMemberships: many(teamMembers),
}));

export const orgsRelations = relations(orgs, ({ many }) => ({
  members: many(orgMembers),
  teams: many(teams),
  projects: many(projects),
  boards: many(boards),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  org: one(orgs, { fields: [teams.orgId], references: [orgs.id] }),
  members: many(teamMembers),
  projects: many(projects),
  boards: many(boards),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  org: one(orgs, { fields: [projects.orgId], references: [orgs.id] }),
  team: one(teams, { fields: [projects.teamId], references: [teams.id] }),
  boards: many(boards),
  tickets: many(tickets),
}));

export const boardsRelations = relations(boards, ({ one, many }) => ({
  org: one(orgs, { fields: [boards.orgId], references: [orgs.id] }),
  team: one(teams, { fields: [boards.teamId], references: [teams.id] }),
  project: one(projects, { fields: [boards.projectId], references: [projects.id] }),
  columns: many(columns),
  tickets: many(tickets),
}));

export const columnsRelations = relations(columns, ({ one, many }) => ({
  board: one(boards, { fields: [columns.boardId], references: [boards.id] }),
  tickets: many(tickets),
}));

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  board: one(boards, { fields: [tickets.boardId], references: [boards.id] }),
  column: one(columns, { fields: [tickets.columnId], references: [columns.id] }),
  assignee: one(users, { fields: [tickets.assigneeId], references: [users.id] }),
  reporter: one(users, { fields: [tickets.reporterId], references: [users.id] }),
  comments: many(ticketComments),
  activities: many(ticketActivities),
  attachments: many(ticketAttachments),
  links: many(ticketLinks),
}));

export const systemSettingsRelations = relations(systemSettings, ({ one }) => ({
  updatedBy: one(users, { fields: [systemSettings.updatedById], references: [users.id] }),
}));


