import { and, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  notifications,
  ticketComments,
  tickets,
  ticketWatchers,
  userNotificationPreferences,
  users,
  type NotificationType,
} from "@/db/schema";
import { getAccessibleTeamIds } from "./rbac";
import { getSystemSetting } from "./settings";
import { canUserViewTicket, getUserNotificationPrefs } from "./watchers";
import { mentionsToPlainText } from "./mentions";
import { backgroundWorker, type DomainEventRow } from "./worker";
import { NotFoundError } from "./errors";

export type NotificationTab = "all" | "unread" | "mentions" | "assigned" | "watching" | "archived";

export interface NotificationViewItem {
  id: string;
  type: NotificationType;
  ticketId: string;
  commentId: string | null;
  actorId: string | null;
  actorName: string | null;
  ticketKey: string | null;
  ticketTitle: string;
  boardId: string | null;
  eventKind: string;
  count: number;
  snippet: string | null;
  ticketMuted: boolean;
  redacted: boolean;
  readAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type EmailHook = (input: {
  notificationId: string;
  recipientId: string;
  type: NotificationType;
  ticketId: string;
  commentId: string | null;
  actorId: string | null;
  snippet: string | null;
}) => Promise<void>;

type WebhookHook = (event: DomainEventRow) => Promise<void>;

let emailHook: EmailHook | null = null;
let webhookHook: WebhookHook | null = null;

export function setNotificationEmailHook(fn: EmailHook): void {
  emailHook = fn;
}

export function setDomainEventWebhookHook(fn: WebhookHook): void {
  webhookHook = fn;
}

async function notifyUserRealtime(recipientId: string, notificationId: string): Promise<void> {
  try {
    await pool.query("SELECT pg_notify('patchwork_user_notifications', $1)", [
      JSON.stringify({ recipientId, notificationId }),
    ]);
  } catch {
    // Best effort; client also catches up on reconnect
  }
}

function buildSnippet(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const plain = mentionsToPlainText(raw).replace(/\s+/g, " ").trim();
  if (!plain) return null;
  return plain.length > 140 ? `${plain.slice(0, 137)}...` : plain;
}

async function createOrCoalesceNotification(input: {
  recipientId: string;
  type: NotificationType;
  ticketId: string;
  commentId: string | null;
  actorId: string | null;
  ticketKey: string;
  eventKind: string;
  snippet: string | null;
  dedupeKey: string;
  groupKey: string;
  coalesceWindowMs?: number;
}): Promise<{ id: string; insertedOrUpdated: boolean }> {
  if (input.coalesceWindowMs && input.type === "watched_update") {
    const since = new Date(Date.now() - input.coalesceWindowMs);
    const [existing] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, input.recipientId),
          eq(notifications.type, "watched_update"),
          eq(notifications.groupKey, input.groupKey),
          isNull(notifications.readAt),
          isNull(notifications.archivedAt),
          gte(notifications.updatedAt, since)
        )
      )
      .orderBy(desc(notifications.updatedAt))
      .limit(1);

    if (existing) {
      const prevSummary = (existing.summary || {}) as Record<string, unknown>;
      const prevCount = typeof prevSummary.count === "number" ? prevSummary.count : 1;
      await db
        .update(notifications)
        .set({
          actorId: input.actorId,
          commentId: input.commentId ?? existing.commentId,
          updatedAt: new Date(),
          summary: {
            ...prevSummary,
            ticketKey: input.ticketKey,
            eventKind: input.eventKind,
            count: prevCount + 1,
            snippet: input.snippet ?? prevSummary.snippet ?? null,
          },
        })
        .where(eq(notifications.id, existing.id));

      return { id: existing.id, insertedOrUpdated: true };
    }
  }

  const [inserted] = await db
    .insert(notifications)
    .values({
      recipientId: input.recipientId,
      type: input.type,
      ticketId: input.ticketId,
      commentId: input.commentId,
      actorId: input.actorId,
      summary: {
        ticketKey: input.ticketKey,
        eventKind: input.eventKind,
        count: 1,
        snippet: input.snippet,
      },
      dedupeKey: input.dedupeKey,
      groupKey: input.groupKey,
    })
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning({ id: notifications.id });

  if (!inserted) {
    return { id: "", insertedOrUpdated: false };
  }
  return { id: inserted.id, insertedOrUpdated: true };
}

/**
 * Fans out a domain event into in-app notifications, email outbox, and webhook deliveries.
 */
export async function processDomainEventForNotifications(
  event: DomainEventRow
): Promise<void> {
  if (webhookHook) {
    await webhookHook(event).catch(() => undefined);
  }

  if (event.eventType === "ticket.deleted" || event.eventType === "watcher.added" || event.eventType === "watcher.removed") {
    return;
  }

  const [ticket] = await db
    .select({
      id: tickets.id,
      key: tickets.key,
      title: tickets.title,
      description: tickets.description,
      orgId: tickets.orgId,
      teamId: tickets.teamId,
      boardId: tickets.boardId,
      assigneeId: tickets.assigneeId,
      archivedAt: tickets.archivedAt,
    })
    .from(tickets)
    .where(eq(tickets.id, event.aggregateId))
    .limit(1);

  if (!ticket || ticket.archivedAt) return;

  const meta = event.metadata || {};
  const commentId = typeof meta.commentId === "string" ? meta.commentId : null;
  let snippet: string | null = null;

  if (commentId && (event.eventType === "comment.created" || event.eventType === "comment.edited")) {
    const [commentRow] = await db
      .select({ body: ticketComments.body })
      .from(ticketComments)
      .where(eq(ticketComments.id, commentId))
      .limit(1);
    snippet = buildSnippet(commentRow?.body);
  } else if (
    event.eventType === "ticket.created" ||
    (event.eventType === "ticket.updated" && meta.descriptionEdited)
  ) {
    snippet = buildSnippet(ticket.description);
  }

  const alreadyNotified = new Set<string>();
  const mentionedIds = Array.isArray(meta.mentionedUserIds)
    ? meta.mentionedUserIds.filter((v): v is string => typeof v === "string")
    : [];

  // 1. Mentions (never coalesce, never self)
  for (const recipientId of mentionedIds) {
    if (recipientId === event.actorId) continue;
    if (!(await canUserViewTicket(recipientId, ticket))) continue;
    const prefs = await getUserNotificationPrefs(recipientId);
    alreadyNotified.add(recipientId);

    if (prefs.inAppMentions) {
      const res = await createOrCoalesceNotification({
        recipientId,
        type: "mention",
        ticketId: ticket.id,
        commentId,
        actorId: event.actorId,
        ticketKey: ticket.key,
        eventKind: event.eventType,
        snippet,
        dedupeKey: `${event.id}:${recipientId}:mention`,
        groupKey: `mention:${event.id}:${recipientId}`,
      });
      if (res.insertedOrUpdated && res.id) {
        await notifyUserRealtime(recipientId, res.id);
        if (emailHook) {
          await emailHook({
            notificationId: res.id,
            recipientId,
            type: "mention",
            ticketId: ticket.id,
            commentId,
            actorId: event.actorId,
            snippet,
          }).catch(() => undefined);
        }
      }
    }
  }

  // 2. Assignment / Unassignment
  const assignedTo =
    event.eventType === "ticket.created" && typeof meta.assigneeId === "string"
      ? meta.assigneeId
      : event.eventType === "ticket.updated" && typeof meta.assigneeTo === "string"
      ? meta.assigneeTo
      : null;

  if (assignedTo && assignedTo !== event.actorId && !alreadyNotified.has(assignedTo)) {
    if (await canUserViewTicket(assignedTo, ticket)) {
      const prefs = await getUserNotificationPrefs(assignedTo);
      alreadyNotified.add(assignedTo);
      if (prefs.inAppAssignments) {
        const res = await createOrCoalesceNotification({
          recipientId: assignedTo,
          type: "assignment",
          ticketId: ticket.id,
          commentId: null,
          actorId: event.actorId,
          ticketKey: ticket.key,
          eventKind: "assigned",
          snippet: null,
          dedupeKey: `${event.id}:${assignedTo}:assignment`,
          groupKey: `assignment:${event.id}:${assignedTo}`,
        });
        if (res.insertedOrUpdated && res.id) {
          await notifyUserRealtime(assignedTo, res.id);
          if (emailHook) {
            await emailHook({
              notificationId: res.id,
              recipientId: assignedTo,
              type: "assignment",
              ticketId: ticket.id,
              commentId: null,
              actorId: event.actorId,
              snippet: null,
            }).catch(() => undefined);
          }
        }
      }
    }
  }

  // 3. Watched updates
  const isWatchedUpdateEvent =
    event.eventType === "comment.created" ||
    (event.eventType === "ticket.moved" && meta.crossColumn === true) ||
    (event.eventType === "ticket.updated" &&
      (Boolean(meta.priorityTo) ||
        Boolean(meta.descriptionEdited) ||
        "assigneeTo" in meta));

  if (!isWatchedUpdateEvent) return;

  const watcherRows = await db
    .select({
      userId: ticketWatchers.userId,
      inAppWatched: userNotificationPreferences.inAppWatched,
    })
    .from(ticketWatchers)
    .innerJoin(users, eq(users.id, ticketWatchers.userId))
    .leftJoin(
      userNotificationPreferences,
      eq(userNotificationPreferences.userId, ticketWatchers.userId)
    )
    .where(
      and(
        eq(ticketWatchers.ticketId, ticket.id),
        isNull(ticketWatchers.unwatchedAt),
        eq(ticketWatchers.muted, false),
        eq(users.isDeactivated, false),
        ...(event.actorId ? [ne(ticketWatchers.userId, event.actorId)] : [])
      )
    );

  const eventKind =
    event.eventType === "comment.created"
      ? "commented"
      : event.eventType === "ticket.moved"
      ? `moved to ${String(meta.toColumnName || "column")}`
      : meta.priorityTo
      ? `changed priority to ${String(meta.priorityTo)}`
      : meta.descriptionEdited
      ? "updated description"
      : "updated ticket";

  for (const w of watcherRows) {
    if (alreadyNotified.has(w.userId)) continue;
    if (w.inAppWatched === false) continue;
    if (!(await canUserViewTicket(w.userId, ticket))) continue;

    const res = await createOrCoalesceNotification({
      recipientId: w.userId,
      type: "watched_update",
      ticketId: ticket.id,
      commentId,
      actorId: event.actorId,
      ticketKey: ticket.key,
      eventKind,
      snippet: event.eventType === "comment.created" ? snippet : null,
      dedupeKey: `${event.id}:${w.userId}:watched_update`,
      groupKey: `watched:${ticket.id}`,
      coalesceWindowMs: 5 * 60 * 1000,
    });
    if (res.insertedOrUpdated && res.id) {
      await notifyUserRealtime(w.userId, res.id);
    }
  }
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM notifications
     WHERE recipient_id = $1 AND read_at IS NULL AND archived_at IS NULL`,
    [userId]
  );
  return Number(res.rows[0]?.count || 0);
}

export async function listNotifications(
  viewerId: string,
  options?: {
    tab?: NotificationTab;
    cursor?: string | null;
    sinceId?: string | null;
    limit?: number;
    q?: string;
  }
): Promise<{
  items: NotificationViewItem[];
  unreadCount: number;
  nextCursor: string | null;
}> {
  const tab = options?.tab || "all";
  const limit = Math.min(Math.max(options?.limit ?? 25, 1), 100);
  const accessibleTeamIds = new Set(await getAccessibleTeamIds(viewerId));

  const params: unknown[] = [viewerId];
  const conditions: string[] = ["n.recipient_id = $1"];

  if (tab === "archived") {
    conditions.push("n.archived_at IS NOT NULL");
  } else {
    conditions.push("n.archived_at IS NULL");
    if (tab === "unread") {
      conditions.push("n.read_at IS NULL");
    } else if (tab === "mentions") {
      conditions.push("n.type = 'mention'");
    } else if (tab === "assigned") {
      conditions.push("n.type IN ('assignment', 'unassignment')");
    } else if (tab === "watching") {
      conditions.push("n.type = 'watched_update'");
    }
  }

  if (options?.q && options.q.trim()) {
    params.push(`%${options.q.trim()}%`);
    const idx = params.length;
    conditions.push(
      `(t.key ILIKE $${idx} OR t.title ILIKE $${idx} OR COALESCE(n.summary->>'snippet', '') ILIKE $${idx})`
    );
  }

  if (options?.cursor) {
    const [tsStr, cursorId] = options.cursor.split("|");
    if (tsStr && cursorId) {
      params.push(tsStr, cursorId);
      const tsIdx = params.length - 1;
      const idIdx = params.length;
      conditions.push(`(n.created_at, n.id) < ($${tsIdx}::timestamptz, $${idIdx}::uuid)`);
    }
  }

  params.push(limit + 1);
  const limitIdx = params.length;

  const sqlQuery = `
    SELECT
      n.id,
      n.type,
      n.ticket_id,
      n.comment_id,
      n.actor_id,
      n.summary,
      n.read_at,
      n.archived_at,
      n.created_at,
      n.updated_at,
      u.name AS actor_name,
      t.key AS ticket_key,
      t.title AS ticket_title,
      t.team_id AS ticket_team_id,
      t.board_id AS ticket_board_id,
      COALESCE(tw.muted, false) AS ticket_muted
    FROM notifications n
    INNER JOIN tickets t ON t.id = n.ticket_id
    LEFT JOIN users u ON u.id = n.actor_id
    LEFT JOIN ticket_watchers tw ON tw.ticket_id = n.ticket_id AND tw.user_id = $1 AND tw.unwatched_at IS NULL
    WHERE ${conditions.join(" AND ")}
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT $${limitIdx}
  `;

  const [rowsRes, unreadCount] = await Promise.all([
    pool.query<{
      id: string;
      type: NotificationType;
      ticket_id: string;
      comment_id: string | null;
      actor_id: string | null;
      summary: Record<string, unknown>;
      read_at: Date | null;
      archived_at: Date | null;
      created_at: Date;
      updated_at: Date;
      actor_name: string | null;
      ticket_key: string;
      ticket_title: string;
      ticket_team_id: string;
      ticket_board_id: string;
      ticket_muted: boolean;
    }>(sqlQuery, params),
    getUnreadNotificationCount(viewerId),
  ]);

  const hasMore = rowsRes.rows.length > limit;
  const slice = hasMore ? rowsRes.rows.slice(0, limit) : rowsRes.rows;

  const items: NotificationViewItem[] = slice.map((r) => {
    const hasAccess = accessibleTeamIds.has(r.ticket_team_id);
    const summary = r.summary || {};
    const count = typeof summary.count === "number" ? summary.count : 1;
    const eventKind = typeof summary.eventKind === "string" ? summary.eventKind : r.type;
    const rawSnippet = typeof summary.snippet === "string" ? summary.snippet : null;

    if (!hasAccess) {
      return {
        id: r.id,
        type: r.type,
        ticketId: r.ticket_id,
        commentId: null,
        actorId: null,
        actorName: null,
        ticketKey: null,
        ticketTitle: "You no longer have access to this ticket",
        boardId: null,
        eventKind: "redacted",
        count: 1,
        snippet: null,
        ticketMuted: false,
        redacted: true,
        readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
        archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
      };
    }

    return {
      id: r.id,
      type: r.type,
      ticketId: r.ticket_id,
      commentId: r.comment_id,
      actorId: r.actor_id,
      actorName: r.actor_name,
      ticketKey: r.ticket_key,
      ticketTitle: r.ticket_title,
      boardId: r.ticket_board_id,
      eventKind,
      count,
      snippet: rawSnippet,
      ticketMuted: Boolean(r.ticket_muted),
      redacted: false,
      readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
      archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  });

  const last = slice[slice.length - 1];
  const nextCursor =
    hasMore && last
      ? `${new Date(last.created_at).toISOString()}|${last.id}`
      : null;

  return { items, unreadCount, nextCursor };
}

export async function markNotificationRead(
  viewerId: string,
  notificationId: string,
  read: boolean
): Promise<void> {
  const res = await db
    .update(notifications)
    .set({ readAt: read ? new Date() : null })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.recipientId, viewerId)
      )
    )
    .returning({ id: notifications.id });

  if (res.length === 0) {
    throw new NotFoundError("Notification not found");
  }
}

export async function markAllNotificationsRead(viewerId: string): Promise<number> {
  const res = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.recipientId, viewerId),
        isNull(notifications.readAt),
        isNull(notifications.archivedAt)
      )
    )
    .returning({ id: notifications.id });
  return res.length;
}

export async function archiveNotification(
  viewerId: string,
  notificationId: string,
  archived = true
): Promise<void> {
  const res = await db
    .update(notifications)
    .set({
      archivedAt: archived ? new Date() : null,
      ...(archived ? { readAt: sql`COALESCE(${notifications.readAt}, NOW())` } : {}),
    })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.recipientId, viewerId)
      )
    )
    .returning({ id: notifications.id });

  if (res.length === 0) {
    throw new NotFoundError("Notification not found");
  }
}

export async function cleanupNotificationRetention(): Promise<void> {
  const settings = await getSystemSetting("notifications").catch(() => ({
    retentionReadDays: 90,
    retentionUnreadCap: 500,
  }));
  const readDays = settings.retentionReadDays ?? 90;
  const unreadCap = settings.retentionUnreadCap ?? 500;

  await pool.query(
    `DELETE FROM notifications
     WHERE (read_at IS NOT NULL OR archived_at IS NOT NULL)
       AND created_at < NOW() - ($1 || ' days')::interval`,
    [String(readDays)]
  );

  // Enforce unread cap per recipient
  await pool.query(
    `DELETE FROM notifications
     WHERE id IN (
       SELECT id FROM (
         SELECT id,
                ROW_NUMBER() OVER (PARTITION BY recipient_id ORDER BY created_at DESC, id DESC) AS rn
         FROM notifications
         WHERE read_at IS NULL AND archived_at IS NULL
       ) ranked
       WHERE rn > $1
     )`,
    [unreadCap]
  );
}

// Register worker handlers automatically when this module is loaded
let workerRegistered = false;
export function ensureNotificationWorkerRegistered(): void {
  if (workerRegistered) return;
  workerRegistered = true;
  backgroundWorker.registerDomainEventHandler(processDomainEventForNotifications);
  backgroundWorker.registerMaintenanceTask(cleanupNotificationRetention);
}
ensureNotificationWorkerRegistered();
