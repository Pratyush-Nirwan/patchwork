import { eq, and, asc, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  tickets,
  columns,
  projects,
  ticketActivities,
  ticketComments,
  ticketAttachments,
  ticketLinks,
  users,
  type TicketPriority,
} from "@/db/schema";
import { requireBoardRole, requireTicketRole } from "./rbac";
import { AppError, NotFoundError, ForbiddenError } from "./errors";
import { realtimeHub } from "./realtime";
import { getColumnStage, type WorkflowStage } from "./workflow-stages";
import { emitDomainEvent, notifyDomainEventWorker, type DbOrTx } from "./domain-events";
import { applyAutoWatch, getTicketWatchStatus } from "./watchers";
import { listMentionableUsers, validateAndSanitizeMentions } from "./mentions";

export { getColumnStage, type WorkflowStage };

const VALID_PRIORITIES: TicketPriority[] = ["urgent", "high", "medium", "low", "none"];

export async function recordActivity(
  input: {
    ticketId: string;
    actorId: string;
    action: string;
    details: Record<string, unknown>;
  },
  tx: DbOrTx = db
) {
  const [act] = await tx
    .insert(ticketActivities)
    .values({
      ticketId: input.ticketId,
      actorId: input.actorId,
      action: input.action,
      details: input.details,
    })
    .returning();
  return act;
}

export async function createTicket(
  actorId: string,
  boardId: string,
  input: {
    columnId?: string;
    title: string;
    description?: string;
    priority?: TicketPriority;
    labels?: string[];
    assigneeId?: string | null;
    dueDate?: Date | string | null;
  }
) {
  const { board, role, subRole } = await requireBoardRole(actorId, boardId, "member");
  const title = input.title.trim();
  if (!title) throw new AppError("Ticket title is required", 400);

  const priority = input.priority || "medium";
  if (!VALID_PRIORITIES.includes(priority)) {
    throw new AppError("Invalid priority value", 400);
  }

  let targetColumnId = input.columnId;
  if (!targetColumnId) {
    const boardCols = await db
      .select()
      .from(columns)
      .where(eq(columns.boardId, boardId))
      .orderBy(asc(columns.position));
    const defaultCol =
      boardCols.find((c) => getColumnStage(c.name) === "new") || boardCols[0];
    if (!defaultCol) throw new AppError("Board has no columns", 400);
    targetColumnId = defaultCol.id;
  } else {
    const [col] = await db
      .select()
      .from(columns)
      .where(and(eq(columns.id, targetColumnId), eq(columns.boardId, boardId)))
      .limit(1);
    if (!col) throw new NotFoundError("Target column not found on this board");
  }

  // Testers can create tickets/bugs, but cannot create tickets directly in "In Progress"
  if (role === "member" && (subRole || "developer") === "tester") {
    const [targetCol] = await db
      .select()
      .from(columns)
      .where(eq(columns.id, targetColumnId))
      .limit(1);
    if (targetCol && getColumnStage(targetCol.name) === "in_progress") {
      throw new ForbiddenError(
        "Testers cannot create tickets directly in 'In Progress'. Please report bugs or tasks in 'New' or 'Backlog'."
      );
    }
  }

  const cleanLabels = (input.labels || [])
    .map((l) => l.trim())
    .filter(Boolean);

  const { ticket, domainEvent } = await db.transaction(async (tx) => {
    const [proj] = await tx
      .update(projects)
      .set({
        ticketCounter: sql`${projects.ticketCounter} + 1`,
      })
      .where(eq(projects.id, board.projectId))
      .returning();

    const number = proj.ticketCounter;
    const key = `${proj.key}-${number}`;

    const existingInCol = await tx
      .select()
      .from(tickets)
      .where(eq(tickets.columnId, targetColumnId))
      .orderBy(asc(tickets.position));

    const position = existingInCol.length;
    const rawDesc = input.description?.trim() || "";
    const descMentions = rawDesc
      ? await validateAndSanitizeMentions(rawDesc, { orgId: board.orgId, teamId: board.teamId }, tx)
      : { validUserIds: [], unauthorizedCount: 0, sanitizedMarkdown: "" };
    const mentionedUserIds = descMentions.validUserIds.filter((id) => id !== actorId);

    const [created] = await tx
      .insert(tickets)
      .values({
        orgId: board.orgId,
        teamId: board.teamId,
        projectId: board.projectId,
        boardId: board.id,
        columnId: targetColumnId,
        number,
        key,
        title,
        description: descMentions.sanitizedMarkdown,
        priority,
        labels: cleanLabels,
        labelsText: cleanLabels.join(" "),
        assigneeId: input.assigneeId || null,
        reporterId: actorId,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        position,
      })
      .returning();

    await recordActivity(
      {
        ticketId: created.id,
        actorId,
        action: "ticket.created",
        details: {
          key: created.key,
          title: created.title,
          columnId: created.columnId,
          priority: created.priority,
        },
      },
      tx
    );

    const ev = await emitDomainEvent(tx, {
      eventType: "ticket.created",
      aggregateId: created.id,
      orgId: board.orgId,
      teamId: board.teamId,
      boardId: board.id,
      actorId,
      metadata: {
        ticketKey: created.key,
        columnId: created.columnId,
        priority: created.priority,
        assigneeId: created.assigneeId,
        reporterId: created.reporterId,
        hasDescription: Boolean(created.description),
        mentionedUserIds,
      },
    });

    await applyAutoWatch(created, actorId, "creator", tx);
    if (created.assigneeId && created.assigneeId !== actorId) {
      await applyAutoWatch(created, created.assigneeId, "assignee", tx);
    }
    for (const mId of mentionedUserIds) {
      await applyAutoWatch(created, mId, "mentioned", tx);
    }

    return { ticket: created, domainEvent: ev };
  });

  await notifyDomainEventWorker(domainEvent?.id);

  await realtimeHub.publish({
    type: "ticket.created",
    orgId: board.orgId,
    teamId: board.teamId,
    boardId: board.id,
    ticketId: ticket.id,
    actorId,
    payload: { ticket },
  });

  return ticket;
}

export async function updateTicket(
  actorId: string,
  ticketId: string,
  input: {
    title?: string;
    description?: string;
    priority?: TicketPriority;
    labels?: string[];
    assigneeId?: string | null;
    dueDate?: Date | string | null;
  }
) {
  const { ticket } = await requireTicketRole(actorId, ticketId, "member");
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const updates: Partial<typeof tickets.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.title !== undefined) {
    const trimmed = input.title.trim();
    if (!trimmed) throw new AppError("Ticket title cannot be empty", 400);
    if (trimmed !== ticket.title) {
      changes.title = { from: ticket.title, to: trimmed };
      updates.title = trimmed;
    }
  }

  if (input.description !== undefined && input.description !== ticket.description) {
    changes.description = { from: ticket.description, to: input.description };
    updates.description = input.description;
  }

  if (input.priority !== undefined) {
    if (!VALID_PRIORITIES.includes(input.priority)) {
      throw new AppError("Invalid priority value", 400);
    }
    if (input.priority !== ticket.priority) {
      changes.priority = { from: ticket.priority, to: input.priority };
      updates.priority = input.priority;
    }
  }

  if (input.labels !== undefined) {
    const cleanLabels = input.labels.map((l) => l.trim()).filter(Boolean);
    if (JSON.stringify(cleanLabels) !== JSON.stringify(ticket.labels)) {
      changes.labels = { from: ticket.labels, to: cleanLabels };
      updates.labels = cleanLabels;
      updates.labelsText = cleanLabels.join(" ");
    }
  }

  if (input.assigneeId !== undefined && input.assigneeId !== ticket.assigneeId) {
    changes.assigneeId = { from: ticket.assigneeId, to: input.assigneeId };
    updates.assigneeId = input.assigneeId;
  }

  if (input.dueDate !== undefined) {
    const nextDate = input.dueDate ? new Date(input.dueDate) : null;
    const prevDateIso = ticket.dueDate ? new Date(ticket.dueDate).toISOString() : null;
    const nextDateIso = nextDate ? nextDate.toISOString() : null;
    if (prevDateIso !== nextDateIso) {
      changes.dueDate = { from: prevDateIso, to: nextDateIso };
      updates.dueDate = nextDate;
    }
  }

  const { updated, domainEvent } = await db.transaction(async (tx) => {
    let newlyMentionedUserIds: string[] = [];
    if (updates.description !== undefined) {
      const prevMentions = await validateAndSanitizeMentions(ticket.description, ticket, tx);
      const nextMentions = await validateAndSanitizeMentions(updates.description, ticket, tx);
      const prevSet = new Set(prevMentions.validUserIds);
      newlyMentionedUserIds = nextMentions.validUserIds.filter(
        (id) => id !== actorId && !prevSet.has(id)
      );
      updates.description = nextMentions.sanitizedMarkdown;
    }

    const [row] = await tx
      .update(tickets)
      .set(updates)
      .where(eq(tickets.id, ticketId))
      .returning();

    let ev = null;
    if (Object.keys(changes).length > 0) {
      await recordActivity(
        {
          ticketId,
          actorId,
          action: "ticket.updated",
          details: { changes },
        },
        tx
      );

      ev = await emitDomainEvent(tx, {
        eventType: "ticket.updated",
        aggregateId: ticket.id,
        orgId: ticket.orgId,
        teamId: ticket.teamId,
        boardId: ticket.boardId,
        actorId,
        metadata: {
          ticketKey: ticket.key,
          changedFields: Object.keys(changes),
          assigneeFrom: changes.assigneeId ? changes.assigneeId.from : undefined,
          assigneeTo: changes.assigneeId ? changes.assigneeId.to : undefined,
          priorityFrom: changes.priority ? changes.priority.from : undefined,
          priorityTo: changes.priority ? changes.priority.to : undefined,
          descriptionEdited: Boolean(changes.description),
          mentionedUserIds: newlyMentionedUserIds,
        },
      });

      if (changes.assigneeId && row.assigneeId) {
        await applyAutoWatch(row, row.assigneeId, "assignee", tx);
      }
      for (const mId of newlyMentionedUserIds) {
        await applyAutoWatch(row, mId, "mentioned", tx);
      }
    }

    return { updated: row, domainEvent: ev };
  });

  if (Object.keys(changes).length > 0) {
    await notifyDomainEventWorker(domainEvent?.id);

    await realtimeHub.publish({
      type: "ticket.updated",
      orgId: ticket.orgId,
      teamId: ticket.teamId,
      boardId: ticket.boardId,
      ticketId: ticket.id,
      actorId,
      payload: { ticket: updated, changes },
    });
  }

  return updated;
}

export async function moveTicket(
  actorId: string,
  ticketId: string,
  input: {
    targetColumnId: string;
    targetPosition?: number;
  }
) {
  const { ticket, role, subRole } = await requireTicketRole(actorId, ticketId, "member");
  const [sourceCol] = await db
    .select()
    .from(columns)
    .where(eq(columns.id, ticket.columnId))
    .limit(1);

  const [targetCol] = await db
    .select()
    .from(columns)
    .where(and(eq(columns.id, input.targetColumnId), eq(columns.boardId, ticket.boardId)))
    .limit(1);

  if (!targetCol) {
    throw new NotFoundError("Target column not found on this board");
  }

  const sourceColumnId = ticket.columnId;
  const isSameColumn = sourceColumnId === targetCol.id;

  if (!isSameColumn) {
    // Validate workflow transition for cross-column moves
    // Validate workflow transition for cross-column moves (sequential advancing)
    const boardCols = await db
      .select()
      .from(columns)
      .where(eq(columns.boardId, ticket.boardId))
      .orderBy(asc(columns.position), asc(columns.createdAt));

    const sourceIndex = boardCols.findIndex((c) => c.id === sourceColumnId);
    const targetIndex = boardCols.findIndex((c) => c.id === targetCol.id);

    // If advancing forward more than 1 column and actor is a standard member (not admin or lead)
    if (
      sourceIndex !== -1 &&
      targetIndex !== -1 &&
      targetIndex > sourceIndex + 1 &&
      role !== "admin" &&
      role !== "lead"
    ) {
      const nextCol = boardCols[sourceIndex + 1];
      throw new AppError(
        `Invalid ticket transition: cannot advance directly from "${sourceCol?.name || "current column"}" to "${targetCol.name}". Tickets must advance sequentially (next step: "${nextCol?.name || "next column"}").`,
        400,
        "INVALID_TRANSITION"
      );
    }

    const sourceStage = sourceCol ? getColumnStage(sourceCol.name) : "custom";
    const targetStage = getColumnStage(targetCol.name);

    // Sub-role SDLC permission checks for standard members (lead and admin have full override authority)
    if (role === "member") {
      const activeSubRole = subRole || "developer";

      if (activeSubRole === "developer") {
        // Disallow developer signing off directly to Done from QA, or bypassing QA directly to Done
        if (targetStage === "done") {
          throw new ForbiddenError(
            `Developers cannot move tickets directly to "Done". Only Testers, Team Leads, or Admins can sign off on verification.`
          );
        }
        // Disallow developer moving ticket out of QA
        if (sourceStage === "qa") {
          throw new ForbiddenError(
            `Developers cannot transition tickets out of "QA". Only Testers, Team Leads, or Admins can verify or reject QA tickets.`
          );
        }
      } else if (activeSubRole === "tester") {
        // Testers cannot start development (Backlog/New -> In Progress)
        if ((sourceStage === "backlog" || sourceStage === "new") && targetStage === "in_progress") {
          throw new ForbiddenError(
            `Testers cannot move tickets from "${sourceCol?.name || "Backlog"}" to "In Progress". Only Developers, Team Leads, or Admins can start development.`
          );
        }
        // Testers cannot mark development complete (In Progress -> In Review)
        if (sourceStage === "in_progress" && targetStage === "in_review") {
          throw new ForbiddenError(
            `Testers cannot move tickets from "In Progress" to "In Review". Only Developers can submit code for review.`
          );
        }
        // Testers cannot bypass QA straight from In Progress or In Review to Done
        if ((sourceStage === "in_progress" || sourceStage === "in_review") && targetStage === "done") {
          throw new ForbiddenError(
            `Tickets must transition to "QA" for testing before being moved to "Done".`
          );
        }
      }
    }
  }

  if (isSameColumn) {
    const { updated, desiredIndex, domainEvent } = await db.transaction(async (tx) => {
      const colTickets = await tx
        .select()
        .from(tickets)
        .where(eq(tickets.columnId, sourceColumnId))
        .orderBy(asc(tickets.position), asc(tickets.createdAt));

      const withoutMoved = colTickets.filter((t) => t.id !== ticket.id);
      const nextIndex =
        input.targetPosition !== undefined
          ? Math.max(0, Math.min(input.targetPosition, withoutMoved.length))
          : withoutMoved.length;

      withoutMoved.splice(nextIndex, 0, ticket);

      for (let i = 0; i < withoutMoved.length; i++) {
        await tx
          .update(tickets)
          .set({ position: i, updatedAt: new Date() })
          .where(eq(tickets.id, withoutMoved[i].id));
      }

      const [row] = await tx
        .select()
        .from(tickets)
        .where(eq(tickets.id, ticket.id))
        .limit(1);

      await recordActivity(
        {
          ticketId: ticket.id,
          actorId,
          action: "ticket.moved",
          details: {
            fromColumnId: sourceColumnId,
            toColumnId: targetCol.id,
            fromColumnName: sourceCol?.name || "",
            toColumnName: targetCol.name,
            fromPosition: ticket.position,
            toPosition: nextIndex,
          },
        },
        tx
      );

      const ev = await emitDomainEvent(tx, {
        eventType: "ticket.moved",
        aggregateId: ticket.id,
        orgId: ticket.orgId,
        teamId: ticket.teamId,
        boardId: ticket.boardId,
        actorId,
        metadata: {
          ticketKey: ticket.key,
          fromColumnId: sourceColumnId,
          toColumnId: targetCol.id,
          fromColumnName: sourceCol?.name || "",
          toColumnName: targetCol.name,
          crossColumn: false,
        },
      });

      return { updated: row, desiredIndex: nextIndex, domainEvent: ev };
    });

    await notifyDomainEventWorker(domainEvent?.id);

    await realtimeHub.publish({
      type: "ticket.moved",
      orgId: ticket.orgId,
      teamId: ticket.teamId,
      boardId: ticket.boardId,
      ticketId: ticket.id,
      actorId,
      payload: {
        ticket: updated,
        fromColumnId: sourceColumnId,
        toColumnId: targetCol.id,
        toPosition: desiredIndex,
      },
    });

    return updated;
  } else {
    const { updated, desiredIndex, domainEvent } = await db.transaction(async (tx) => {
      const sourceTickets = await tx
        .select()
        .from(tickets)
        .where(eq(tickets.columnId, sourceColumnId))
        .orderBy(asc(tickets.position), asc(tickets.createdAt));

      const remainingSource = sourceTickets.filter((t) => t.id !== ticket.id);
      for (let i = 0; i < remainingSource.length; i++) {
        await tx
          .update(tickets)
          .set({ position: i })
          .where(eq(tickets.id, remainingSource[i].id));
      }

      const destTickets = await tx
        .select()
        .from(tickets)
        .where(eq(tickets.columnId, targetCol.id))
        .orderBy(asc(tickets.position), asc(tickets.createdAt));

      const nextIndex =
        input.targetPosition !== undefined
          ? Math.max(0, Math.min(input.targetPosition, destTickets.length))
          : destTickets.length;

      destTickets.splice(nextIndex, 0, ticket);

      for (let i = 0; i < destTickets.length; i++) {
        const item = destTickets[i];
        await tx
          .update(tickets)
          .set({
            columnId: targetCol.id,
            position: i,
            updatedAt: item.id === ticket.id ? new Date() : item.updatedAt,
          })
          .where(eq(tickets.id, item.id));
      }

      const [row] = await tx
        .select()
        .from(tickets)
        .where(eq(tickets.id, ticket.id))
        .limit(1);

      await recordActivity(
        {
          ticketId: ticket.id,
          actorId,
          action: "ticket.moved",
          details: {
            fromColumnId: sourceColumnId,
            toColumnId: targetCol.id,
            fromColumnName: sourceCol?.name || "",
            toColumnName: targetCol.name,
            fromPosition: ticket.position,
            toPosition: nextIndex,
          },
        },
        tx
      );

      const ev = await emitDomainEvent(tx, {
        eventType: "ticket.moved",
        aggregateId: ticket.id,
        orgId: ticket.orgId,
        teamId: ticket.teamId,
        boardId: ticket.boardId,
        actorId,
        metadata: {
          ticketKey: ticket.key,
          fromColumnId: sourceColumnId,
          toColumnId: targetCol.id,
          fromColumnName: sourceCol?.name || "",
          toColumnName: targetCol.name,
          crossColumn: true,
        },
      });

      return { updated: row, desiredIndex: nextIndex, domainEvent: ev };
    });

    await notifyDomainEventWorker(domainEvent?.id);

    await realtimeHub.publish({
      type: "ticket.moved",
      orgId: ticket.orgId,
      teamId: ticket.teamId,
      boardId: ticket.boardId,
      ticketId: ticket.id,
      actorId,
      payload: {
        ticket: updated,
        fromColumnId: sourceColumnId,
        toColumnId: targetCol.id,
        toPosition: desiredIndex,
      },
    });

    return updated;
  }
}

export async function archiveTicket(actorId: string, ticketId: string) {
  const { ticket } = await requireTicketRole(actorId, ticketId, "member");
  if (ticket.archivedAt) {
    return ticket;
  }

  const now = new Date();
  const { updated, domainEvent } = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(tickets)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(tickets.id, ticketId))
      .returning();

    await recordActivity(
      {
        ticketId,
        actorId,
        action: "ticket.archived",
        details: { archivedAt: now.toISOString() },
      },
      tx
    );

    const ev = await emitDomainEvent(tx, {
      eventType: "ticket.archived",
      aggregateId: ticket.id,
      orgId: ticket.orgId,
      teamId: ticket.teamId,
      boardId: ticket.boardId,
      actorId,
      metadata: { ticketKey: ticket.key },
    });

    return { updated: row, domainEvent: ev };
  });

  await notifyDomainEventWorker(domainEvent?.id);

  await realtimeHub.publish({
    type: "ticket.deleted",
    orgId: ticket.orgId,
    teamId: ticket.teamId,
    boardId: ticket.boardId,
    ticketId: ticket.id,
    actorId,
    payload: { ticketId: ticket.id, archived: true },
  });

  return updated;
}

export async function deleteTicket(actorId: string, ticketId: string) {
  const { ticket, role } = await requireTicketRole(actorId, ticketId, "member");
  if (role === "member" && ticket.reporterId !== actorId) {
    throw new ForbiddenError("Only team leads, admins, or the ticket reporter can delete a ticket");
  }

  const domainEvent = await db.transaction(async (tx) => {
    await tx.delete(tickets).where(eq(tickets.id, ticketId));
    return emitDomainEvent(tx, {
      eventType: "ticket.deleted",
      aggregateId: ticket.id,
      orgId: ticket.orgId,
      teamId: ticket.teamId,
      boardId: ticket.boardId,
      actorId,
      metadata: { ticketKey: ticket.key },
    });
  });

  await notifyDomainEventWorker(domainEvent?.id);

  await realtimeHub.publish({
    type: "ticket.deleted",
    orgId: ticket.orgId,
    teamId: ticket.teamId,
    boardId: ticket.boardId,
    ticketId: ticket.id,
    actorId,
    payload: { ticketId: ticket.id },
  });
}

export async function getTicketFullDetails(actorId: string, ticketId: string) {
  const { ticket, role, subRole } = await requireTicketRole(actorId, ticketId, "viewer");

  const commentsRows = await db
    .select({
      comment: ticketComments,
      author: {
        id: users.id,
        name: users.name,
        email: users.email,
      },
    })
    .from(ticketComments)
    .innerJoin(users, eq(ticketComments.authorId, users.id))
    .where(eq(ticketComments.ticketId, ticketId))
    .orderBy(asc(ticketComments.createdAt));

  const activityRows = await db
    .select({
      activity: ticketActivities,
      actor: {
        id: users.id,
        name: users.name,
        email: users.email,
      },
    })
    .from(ticketActivities)
    .leftJoin(users, eq(ticketActivities.actorId, users.id))
    .where(eq(ticketActivities.ticketId, ticketId))
    .orderBy(asc(ticketActivities.createdAt));

  const attachmentsRows = await db
    .select({
      id: ticketAttachments.id,
      ticketId: ticketAttachments.ticketId,
      filename: ticketAttachments.filename,
      contentType: ticketAttachments.contentType,
      sizeBytes: ticketAttachments.sizeBytes,
      storageKey: ticketAttachments.storageKey,
      createdAt: ticketAttachments.createdAt,
      uploaderId: ticketAttachments.uploaderId,
    })
    .from(ticketAttachments)
    .where(eq(ticketAttachments.ticketId, ticketId))
    .orderBy(asc(ticketAttachments.createdAt));

  const linksRows = await db
    .select()
    .from(ticketLinks)
    .where(eq(ticketLinks.ticketId, ticketId))
    .orderBy(asc(ticketLinks.createdAt));

  const watchStatus = await getTicketWatchStatus(actorId, ticketId);
  const mentionableList = await listMentionableUsers(ticket);
  const mentionUsers: Record<string, { id: string; name: string }> = {};
  for (const u of mentionableList) {
    mentionUsers[u.id.toLowerCase()] = u;
  }

  return {
    ticket,
    role,
    subRole: subRole || (role === "admin" ? null : role === "lead" ? null : "developer"),
    watchStatus,
    mentionUsers,
    comments: commentsRows.map((r) => ({
      ...r.comment,
      author: r.author,
    })),
    activities: activityRows.map((r) => ({
      ...r.activity,
      actor: r.actor,
    })),
    attachments: attachmentsRows,
    links: linksRows,
  };
}

