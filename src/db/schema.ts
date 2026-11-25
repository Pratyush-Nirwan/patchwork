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

export type WatcherSource = "manual" | "creator" | "assignee" | "commenter" | "mentioned";
export type NotificationType = "mention" | "assignment" | "unassignment" | "watched_update";
export type EmailPreferenceMode = "off" | "immediate" | "digest";
export type DigestFrequency = "daily" | "weekly";
export type WebhookFormat = "generic" | "slack" | "discord" | "mattermost";

export const domainEvents = pgTable(
  "domain_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull().default("ticket"),
    aggregateId: uuid("aggregate_id").notNull(),
    orgId: uuid("org_id").notNull(),
    teamId: uuid("team_id").notNull(),
    boardId: uuid("board_id").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
    lastError: text("last_error"),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
  },
  (table) => [
    index("domain_events_pending_idx").on(table.nextAttemptAt, table.createdAt),
    index("domain_events_aggregate_idx").on(table.aggregateId, table.createdAt),
  ]
);

export const ticketWatchers = pgTable(
  "ticket_watchers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").$type<WatcherSource>().notNull().default("manual"),
    muted: boolean("muted").notNull().default(false),
    unwatchedAt: timestamp("unwatched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ticket_watchers_ticket_user_uidx").on(table.ticketId, table.userId),
    index("ticket_watchers_user_idx").on(table.userId, table.muted),
  ]
);

export const userNotificationPreferences = pgTable("user_notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  inAppMentions: boolean("in_app_mentions").notNull().default(true),
  inAppAssignments: boolean("in_app_assignments").notNull().default(true),
  inAppWatched: boolean("in_app_watched").notNull().default(true),
  emailMentions: text("email_mentions").$type<EmailPreferenceMode>().notNull().default("immediate"),
  emailAssignments: text("email_assignments")
    .$type<EmailPreferenceMode>()
    .notNull()
    .default("immediate"),
  emailWatched: text("email_watched").$type<EmailPreferenceMode>().notNull().default("off"),
  digestFrequency: text("digest_frequency").$type<DigestFrequency>().notNull().default("daily"),
  digestHour: integer("digest_hour").notNull().default(9),
  digestDay: integer("digest_day").notNull().default(1),
  autoWatchCreator: boolean("auto_watch_creator").notNull().default(true),
  autoWatchAssignee: boolean("auto_watch_assignee").notNull().default(true),
  autoWatchCommenter: boolean("auto_watch_commenter").notNull().default(true),
  autoWatchMentioned: boolean("auto_watch_mentioned").notNull().default(true),
  presenceEnabled: boolean("presence_enabled").notNull().default(true),
  lastDigestSentAt: timestamp("last_digest_sent_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<NotificationType>().notNull(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").references(() => ticketComments.id, { onDelete: "set null" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text("dedupe_key").notNull().unique(),
    groupKey: text("group_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("notifications_recipient_list_idx").on(
      table.recipientId,
      table.archivedAt,
      table.readAt,
      table.createdAt
    ),
    index("notifications_recipient_group_idx").on(
      table.recipientId,
      table.groupKey,
      table.createdAt
    ),
  ]
);

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "set null" }),
    notificationIds: jsonb("notification_ids").$type<string[]>().notNull().default([]),
    subject: text("subject").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: text("status").$type<"pending" | "sent" | "dead_letter">().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("email_outbox_pending_idx").on(table.status, table.nextAttemptAt),
    index("email_outbox_recipient_idx").on(table.recipientId, table.createdAt),
  ]
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    format: text("format").$type<WebhookFormat>().notNull().default("generic"),
    events: text("events")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    scopeTeamIds: uuid("scope_team_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    scopeProjectIds: uuid("scope_project_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    scopeBoardIds: uuid("scope_board_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    secretCiphertext: text("secret_ciphertext").notNull(),
    secretIv: text("secret_iv").notNull(),
    secretAuthTag: text("secret_auth_tag").notNull(),
    secretKeyVersion: integer("secret_key_version").notNull().default(1),
    enabled: boolean("enabled").notNull().default(true),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    disabledReason: text("disabled_reason"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("webhook_endpoints_org_idx").on(table.orgId, table.enabled)]
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    domainEventId: uuid("domain_event_id").references(() => domainEvents.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status")
      .$type<"pending" | "delivered" | "failed" | "dead_letter">()
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
    responseStatus: integer("response_status"),
    durationMs: integer("duration_ms"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("webhook_deliveries_pending_idx").on(table.status, table.nextAttemptAt),
    index("webhook_deliveries_endpoint_idx").on(table.endpointId, table.createdAt),
  ]
);

export const workerHealth = pgTable("worker_health", {
  id: text("id").primaryKey().default("default"),
  workerId: text("worker_id").notNull(),
  mode: text("mode").$type<"embedded" | "separate">().notNull().default("embedded"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }).defaultNow().notNull(),
  processedEvents: integer("processed_events").notNull().default(0),
  lastError: text("last_error"),
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


