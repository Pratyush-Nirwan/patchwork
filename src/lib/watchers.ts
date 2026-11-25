import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  orgMembers,
  teamMembers,
  ticketWatchers,
  tickets,
  userNotificationPreferences,
  users,
  type WatcherSource,
} from "@/db/schema";
import { emitDomainEvent, notifyDomainEventWorker, type DbOrTx } from "./domain-events";
import { requireTicketRole } from "./rbac";

export interface WatcherInfo {
  userId: string;
  name: string;
  source: WatcherSource;
  muted: boolean;
  createdAt: Date;
}

export async function getUserNotificationPrefs(userId: string, tx: DbOrTx = db) {
  const [row] = await tx
    .select()
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId))
    .limit(1);

  if (row) return row;
  return {
    userId,
    inAppMentions: true,
    inAppAssignments: true,
    inAppWatched: true,
    emailMentions: "immediate" as const,
    emailAssignments: "immediate" as const,
    emailWatched: "off" as const,
    digestFrequency: "daily" as const,
    digestHour: 9,
    digestDay: 1,
    autoWatchCreator: true,
    autoWatchAssignee: true,
    autoWatchCommenter: true,
    autoWatchMentioned: true,
    presenceEnabled: true,
    lastDigestSentAt: null,
    updatedAt: new Date(),
  };
}

export async function canUserViewTicket(
  userId: string,
  ticket: { orgId: string; teamId: string },
  tx: DbOrTx = db
): Promise<boolean> {
  const [u] = await tx
    .select({ id: users.id, isDeactivated: users.isDeactivated })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u || u.isDeactivated) return false;

  const [orgMem] = await tx
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, ticket.orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  if (orgMem?.role === "admin") return true;

  const [teamMem] = await tx
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, ticket.teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  return Boolean(teamMem);
}

/**
 * Applies auto-watch rules for a user on a ticket.
 * Respects user preferences and prior explicit unwatch (unless newly assigned or mentioned).
 */
export async function applyAutoWatch(
  ticket: { id: string; orgId: string; teamId: string; boardId: string; key: string },
  userId: string,
  source: Exclude<WatcherSource, "manual">,
  tx: DbOrTx = db
): Promise<boolean> {
  const hasAccess = await canUserViewTicket(userId, ticket, tx);
  if (!hasAccess) return false;

  const prefs = await getUserNotificationPrefs(userId, tx);
  const enabled =
    (source === "creator" && prefs.autoWatchCreator) ||
    (source === "assignee" && prefs.autoWatchAssignee) ||
    (source === "commenter" && prefs.autoWatchCommenter) ||
    (source === "mentioned" && prefs.autoWatchMentioned);
  if (!enabled) return false;

  const [existing] = await tx
    .select()
    .from(ticketWatchers)
    .where(and(eq(ticketWatchers.ticketId, ticket.id), eq(ticketWatchers.userId, userId)))
    .limit(1);

  if (!existing) {
    await tx
      .insert(ticketWatchers)
      .values({
        ticketId: ticket.id,
        userId,
        source,
        muted: false,
        unwatchedAt: null,
      })
      .onConflictDoNothing();
    return true;
  }

  // Already actively watching
  if (existing.unwatchedAt === null) {
    return false;
  }

  // Previously unwatched: only re-watch if newly assigned or mentioned
  if (source === "assignee" || source === "mentioned") {
    await tx
      .update(ticketWatchers)
      .set({
        source,
        unwatchedAt: null,
        muted: false,
      })
      .where(eq(ticketWatchers.id, existing.id));
    return true;
  }

  return false;
}

export async function watchTicket(actorId: string, ticketId: string) {
  const { ticket } = await requireTicketRole(actorId, ticketId, "viewer");

  const ev = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(ticketWatchers)
      .where(and(eq(ticketWatchers.ticketId, ticket.id), eq(ticketWatchers.userId, actorId)))
      .limit(1);

    if (!existing) {
      await tx.insert(ticketWatchers).values({
        ticketId: ticket.id,
        userId: actorId,
        source: "manual",
        muted: false,
        unwatchedAt: null,
      });
    } else if (existing.unwatchedAt !== null) {
      await tx
        .update(ticketWatchers)
        .set({ source: "manual", unwatchedAt: null })
        .where(eq(ticketWatchers.id, existing.id));
    } else {
      return null;
    }

    return emitDomainEvent(tx, {
      eventType: "watcher.added",
      aggregateId: ticket.id,
      orgId: ticket.orgId,
      teamId: ticket.teamId,
      boardId: ticket.boardId,
      actorId,
      metadata: { ticketKey: ticket.key, watcherUserId: actorId, source: "manual" },
    });
  });

  if (ev) await notifyDomainEventWorker(ev.id);
  return getTicketWatchStatus(actorId, ticket.id);
}

export async function unwatchTicket(actorId: string, ticketId: string) {
  const { ticket } = await requireTicketRole(actorId, ticketId, "viewer");

  const ev = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(ticketWatchers)
      .where(and(eq(ticketWatchers.ticketId, ticket.id), eq(ticketWatchers.userId, actorId)))
      .limit(1);

    const now = new Date();
    if (!existing) {
      await tx.insert(ticketWatchers).values({
        ticketId: ticket.id,
        userId: actorId,
        source: "manual",
        muted: false,
        unwatchedAt: now,
      });
    } else if (existing.unwatchedAt === null) {
      await tx
        .update(ticketWatchers)
        .set({ unwatchedAt: now, muted: false })
        .where(eq(ticketWatchers.id, existing.id));
    } else {
      return null;
    }

    return emitDomainEvent(tx, {
      eventType: "watcher.removed",
      aggregateId: ticket.id,
      orgId: ticket.orgId,
      teamId: ticket.teamId,
      boardId: ticket.boardId,
      actorId,
      metadata: { ticketKey: ticket.key, watcherUserId: actorId },
    });
  });

  if (ev) await notifyDomainEventWorker(ev.id);
  return getTicketWatchStatus(actorId, ticket.id);
}

export async function setTicketMute(
  actorId: string,
  ticketId: string,
  muted: boolean
) {
  const { ticket } = await requireTicketRole(actorId, ticketId, "viewer");

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(ticketWatchers)
      .where(and(eq(ticketWatchers.ticketId, ticket.id), eq(ticketWatchers.userId, actorId)))
      .limit(1);

    if (!existing) {
      await tx.insert(ticketWatchers).values({
        ticketId: ticket.id,
        userId: actorId,
        source: "manual",
        muted,
        unwatchedAt: null,
      });
    } else {
      await tx
        .update(ticketWatchers)
        .set({
          muted,
          unwatchedAt: null,
        })
        .where(eq(ticketWatchers.id, existing.id));
    }
  });

  return getTicketWatchStatus(actorId, ticket.id);
}

export async function getTicketWatchStatus(actorId: string, ticketId: string) {
  await requireTicketRole(actorId, ticketId, "viewer");
  const { watchers, totalCount } = await listTicketWatchers(actorId, ticketId, {
    limit: 20,
    offset: 0,
  });
  const [mine] = await db
    .select({ muted: ticketWatchers.muted, unwatchedAt: ticketWatchers.unwatchedAt })
    .from(ticketWatchers)
    .where(and(eq(ticketWatchers.ticketId, ticketId), eq(ticketWatchers.userId, actorId)))
    .limit(1);

  return {
    watching: Boolean(mine && mine.unwatchedAt === null),
    muted: Boolean(mine && mine.unwatchedAt === null && mine.muted),
    watcherCount: totalCount,
    watchers,
  };
}

/**
 * Lists active watchers who currently have view access to the ticket.
 * Never exposes email addresses; names and IDs only.
 */
export async function listTicketWatchers(
  actorId: string,
  ticketId: string,
  options?: { limit?: number; offset?: number }
): Promise<{ watchers: WatcherInfo[]; totalCount: number; hasMore: boolean }> {
  const { ticket } = await requireTicketRole(actorId, ticketId, "viewer");
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
  const offset = Math.max(options?.offset ?? 0, 0);

  // Filter at read-time to users who are active AND still have org admin or team membership
  const rows = await db
    .select({
      userId: ticketWatchers.userId,
      name: users.name,
      source: ticketWatchers.source,
      muted: ticketWatchers.muted,
      createdAt: ticketWatchers.createdAt,
    })
    .from(ticketWatchers)
    .innerJoin(users, eq(users.id, ticketWatchers.userId))
    .where(
      and(
        eq(ticketWatchers.ticketId, ticket.id),
        isNull(ticketWatchers.unwatchedAt),
        eq(users.isDeactivated, false),
        sql`(
          EXISTS (
            SELECT 1 FROM org_members om
            WHERE om.org_id = ${ticket.orgId} AND om.user_id = ${ticketWatchers.userId} AND om.role = 'admin'
          )
          OR EXISTS (
            SELECT 1 FROM team_members tm
            WHERE tm.team_id = ${ticket.teamId} AND tm.user_id = ${ticketWatchers.userId}
          )
        )`
      )
    )
    .orderBy(asc(ticketWatchers.createdAt));

  const totalCount = rows.length;
  const page = rows.slice(offset, offset + limit);
  return {
    watchers: page,
    totalCount,
    hasMore: offset + page.length < totalCount,
  };
}

/**
 * Prunes watchers when a user loses team/org access or is deactivated.
 */
export async function pruneWatchersForUser(userId: string, teamId?: string): Promise<void> {
  if (!teamId) {
    await db.delete(ticketWatchers).where(eq(ticketWatchers.userId, userId));
    return;
  }
  const teamTicketIds = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.teamId, teamId));
  if (teamTicketIds.length === 0) return;

  // Keep if user is org admin for that team's org
  const rows = await db
    .select({ id: ticketWatchers.id, ticketId: ticketWatchers.ticketId })
    .from(ticketWatchers)
    .where(
      and(
        eq(ticketWatchers.userId, userId),
        inArray(
          ticketWatchers.ticketId,
          teamTicketIds.map((t) => t.id)
        )
      )
    );
  if (rows.length === 0) return;

  const [firstTicket] = await db
    .select({ orgId: tickets.orgId, teamId: tickets.teamId })
    .from(tickets)
    .where(eq(tickets.id, rows[0].ticketId))
    .limit(1);
  if (firstTicket && (await canUserViewTicket(userId, firstTicket))) {
    return;
  }

  await db.delete(ticketWatchers).where(
    inArray(
      ticketWatchers.id,
      rows.map((r) => r.id)
    )
  );
}
