import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { ticketComments, users } from "@/db/schema";
import { requireTicketRole } from "./rbac";
import { AppError, ForbiddenError, NotFoundError } from "./errors";
import { recordActivity } from "./tickets";
import { realtimeHub } from "./realtime";
import { emitDomainEvent, notifyDomainEventWorker } from "./domain-events";
import { applyAutoWatch } from "./watchers";
import { validateAndSanitizeMentions } from "./mentions";

export async function addComment(
  actorId: string,
  ticketId: string,
  input: { body: string }
) {
  const { ticket } = await requireTicketRole(actorId, ticketId, "member");
  const rawBody = input.body.trim();
  if (!rawBody) {
    throw new AppError("Comment body cannot be empty", 400);
  }

  const { comment, author, domainEvent, unauthorizedCount } = await db.transaction(async (tx) => {
    const mentionCheck = await validateAndSanitizeMentions(rawBody, ticket, tx);
    const body = mentionCheck.sanitizedMarkdown;
    const mentionedUserIds = mentionCheck.validUserIds.filter((id) => id !== actorId);

    const [inserted] = await tx
      .insert(ticketComments)
      .values({
        ticketId: ticket.id,
        orgId: ticket.orgId,
        teamId: ticket.teamId,
        authorId: actorId,
        body,
      })
      .returning();

    const [authorRow] = await tx
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);

    await recordActivity(
      {
        ticketId: ticket.id,
        actorId,
        action: "comment.added",
        details: {
          commentId: inserted.id,
          preview: body.slice(0, 120),
        },
      },
      tx
    );

    const ev = await emitDomainEvent(tx, {
      eventType: "comment.created",
      aggregateId: ticket.id,
      orgId: ticket.orgId,
      teamId: ticket.teamId,
      boardId: ticket.boardId,
      actorId,
      metadata: {
        ticketKey: ticket.key,
        commentId: inserted.id,
        mentionedUserIds,
      },
    });

    await applyAutoWatch(ticket, actorId, "commenter", tx);
    for (const mId of mentionedUserIds) {
      await applyAutoWatch(ticket, mId, "mentioned", tx);
    }

    return {
      comment: inserted,
      author: authorRow,
      domainEvent: ev,
      unauthorizedCount: mentionCheck.unauthorizedCount,
    };
  });

  await notifyDomainEventWorker(domainEvent?.id);

  const enriched = {
    ...comment,
    author,
    ...(unauthorizedCount > 0
      ? {
        mentionWarning:
          "Some @mentions were not notified because those users do not have access to this ticket.",
      }
      : {}),
  };

  await realtimeHub.publish({
    type: "comment.added",
    orgId: ticket.orgId,
    teamId: ticket.teamId,
    boardId: ticket.boardId,
    ticketId: ticket.id,
    actorId,
    payload: { comment: enriched },
  });

  return enriched;
}

export async function editComment(
  actorId: string,
  ticketId: string,
  commentId: string,
  input: { body: string }
) {
  const { ticket, role } = await requireTicketRole(actorId, ticketId, "member");
  const rawBody = input.body.trim();
  if (!rawBody) {
    throw new AppError("Comment body cannot be empty", 400);
  }

  const [existing] = await db
    .select()
    .from(ticketComments)
    .where(and(eq(ticketComments.id, commentId), eq(ticketComments.ticketId, ticket.id)))
    .limit(1);

  if (!existing) {
    throw new NotFoundError("Comment not found");
  }
  if (existing.authorId !== actorId && role !== "admin" && role !== "lead") {
    throw new ForbiddenError("Only the comment author, team lead, or admin can edit this comment");
  }

  const previousBody = existing.body;
  if (previousBody === rawBody) {
    const [authorRow] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, existing.authorId))
      .limit(1);
    return { ...existing, author: authorRow };
  }

  const { updated, author, domainEvent, unauthorizedCount } = await db.transaction(async (tx) => {
    const prevMentions = await validateAndSanitizeMentions(previousBody, ticket, tx);
    const nextMentions = await validateAndSanitizeMentions(rawBody, ticket, tx);
    const prevSet = new Set(prevMentions.validUserIds);
    const newlyMentionedUserIds = nextMentions.validUserIds.filter(
      (id) => id !== actorId && !prevSet.has(id)
    );
    const body = nextMentions.sanitizedMarkdown;

    const [row] = await tx
      .update(ticketComments)
      .set({ body, updatedAt: new Date() })
      .where(eq(ticketComments.id, commentId))
      .returning();

    const [authorRow] = await tx
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, existing.authorId))
      .limit(1);

    await recordActivity(
      {
        ticketId: ticket.id,
        actorId,
        action: "comment.edited",
        details: {
          commentId: row.id,
          preview: body.slice(0, 120),
        },
      },
      tx
    );

    const ev = await emitDomainEvent(tx, {
      eventType: "comment.edited",
      aggregateId: ticket.id,
      orgId: ticket.orgId,
      teamId: ticket.teamId,
      boardId: ticket.boardId,
      actorId,
      metadata: {
        ticketKey: ticket.key,
        commentId: row.id,
        mentionedUserIds: newlyMentionedUserIds,
      },
    });

    for (const mId of newlyMentionedUserIds) {
      await applyAutoWatch(ticket, mId, "mentioned", tx);
    }

    return {
      updated: row,
      author: authorRow,
      domainEvent: ev,
      unauthorizedCount: nextMentions.unauthorizedCount,
    };
  });

  await notifyDomainEventWorker(domainEvent?.id);

  const enriched = {
    ...updated,
    author,
    ...(unauthorizedCount > 0
      ? {
        mentionWarning:
          "Some @mentions were not notified because those users do not have access to this ticket.",
      }
      : {}),
  };

  await realtimeHub.publish({
    type: "comment.added",
    orgId: ticket.orgId,
    teamId: ticket.teamId,
    boardId: ticket.boardId,
    ticketId: ticket.id,
    actorId,
    payload: { comment: enriched, edited: true },
  });

  return enriched;
}


