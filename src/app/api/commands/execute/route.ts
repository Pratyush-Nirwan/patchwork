import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { columns, teamMembers, tickets, users, type TicketPriority } from "@/db/schema";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { AppError, NotFoundError } from "@/lib/errors";
import { getAccessibleTeamIds, requireTicketRole } from "@/lib/rbac";
import { findCommandDefinition } from "@/lib/commands/registry";
import { parseSlashCommand } from "@/lib/commands/parser";
import {
  archiveTicket,
  createTicket,
  deleteTicket,
  moveTicket,
  updateTicket,
} from "@/lib/tickets";
import { addComment } from "@/lib/comments";
import { addTicketLink } from "@/lib/links";
import { createColumn } from "@/lib/hierarchy";
import { getTicketWatchStatus, setTicketMute, unwatchTicket, watchTicket } from "@/lib/watchers";
import { markAllNotificationsRead } from "@/lib/notifications";

const ExecuteCommandSchema = z.object({
  command: z.string().min(1).max(64),
  positional: z.array(z.string().max(1000)).max(25).default([]),
  flags: z.record(z.string(), z.string().max(500)).default({}),
  rawArgs: z.string().max(2000).default(""),
  context: z
    .object({
      orgId: z.string().uuid().optional(),
      teamId: z.string().uuid().optional(),
      boardId: z.string().uuid().optional(),
      ticketId: z.string().uuid().optional(),
    })
    .optional(),
});

const VALID_PRIORITIES = new Set<TicketPriority>(["urgent", "high", "medium", "low"]);

async function resolveAccessibleTicketByKey(
  userId: string,
  rawKey: string,
  orgId?: string
) {
  const key = rawKey.trim();
  if (!key) {
    throw new AppError("Ticket key is required", 400);
  }
  const accessibleTeamIds = await getAccessibleTeamIds(userId, orgId);
  if (accessibleTeamIds.length === 0) {
    throw new NotFoundError("Ticket not found");
  }
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(
      and(
        inArray(tickets.teamId, accessibleTeamIds),
        isNull(tickets.archivedAt),
        sql`lower(${tickets.key}) = lower(${key})`
      )
    )
    .limit(1);

  if (!ticket) {
    throw new NotFoundError("Ticket not found");
  }
  return ticket;
}

async function resolveColumnOnBoard(boardId: string, rawName: string) {
  const target = rawName.trim().toLowerCase();
  if (!target) {
    throw new AppError("Target column name is required", 400);
  }
  const boardCols = await db
    .select()
    .from(columns)
    .where(eq(columns.boardId, boardId))
    .orderBy(asc(columns.position));

  const exact = boardCols.find((c) => c.name.trim().toLowerCase() === target);
  if (exact) return exact;

  const prefix = boardCols.filter((c) => c.name.trim().toLowerCase().startsWith(target));
  if (prefix.length === 1) return prefix[0];

  const substr = boardCols.filter((c) => c.name.trim().toLowerCase().includes(target));
  if (substr.length === 1) return substr[0];

  throw new AppError(`Column "${rawName}" not found on this board`, 400);
}

async function resolveTeamAssignee(
  teamId: string,
  actorId: string,
  rawTarget: string
): Promise<string | null> {
  const cleaned = rawTarget.trim().replace(/^@/, "");
  const lower = cleaned.toLowerCase();
  if (!lower) {
    throw new AppError("Assignee is required", 400);
  }
  if (lower === "me") return actorId;
  if (lower === "unassigned" || lower === "none") return null;

  const members = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, teamId), eq(users.isDeactivated, false)));

  const exact = members.find(
    (m) => m.email.toLowerCase() === lower || m.name.toLowerCase() === lower
  );
  if (exact) return exact.id;

  const partial = members.filter(
    (m) => m.name.toLowerCase().includes(lower) || m.email.toLowerCase().includes(lower)
  );
  if (partial.length === 1) return partial[0].id;

  throw new AppError(`Team member "${rawTarget}" not found`, 400);
}

function parseDueDateArg(raw: string): Date | null {
  const lower = raw.trim().toLowerCase();
  if (!lower) throw new AppError("Due date value is required", 400);
  if (lower === "none" || lower === "clear") return null;

  const now = new Date();
  if (lower === "today") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0));
  }
  if (lower === "tomorrow") {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 12, 0, 0)
    );
  }

  const parsed = new Date(raw.trim());
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(`Invalid date "${raw}". Use YYYY-MM-DD, today, tomorrow, or none.`, 400);
  }
  return parsed;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    const body = await req.json();
    const parsed = ExecuteCommandSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError("Invalid command payload", 400);
    }

    const { command, rawArgs, context } = parsed.data;
    const def = findCommandDefinition(command);
    if (!def || def.execution !== "server") {
      throw new AppError(`Unsupported server command: /${command}`, 400);
    }

    let positional = parsed.data.positional;
    let flags = parsed.data.flags;
    if (rawArgs && rawArgs.trim().length > 0) {
      const reparsed = parseSlashCommand(`/${def.name} ${rawArgs}`, def);
      if (reparsed.isCommand) {
        positional = reparsed.positional;
        flags = reparsed.flags;
      }
    }

    const actorId = auth.user.id;
    const orgId = context?.orgId;

    switch (def.name) {
      case "new": {
        const boardId = context?.boardId;
        if (!boardId) {
          throw new AppError("Select a board before creating a ticket", 400);
        }
        const title = positional.join(" ").trim();
        if (!title) {
          throw new AppError("Ticket title is required", 400);
        }

        let priority: TicketPriority = "medium";
        if (flags.priority) {
          const p = flags.priority.toLowerCase() as TicketPriority;
          if (!VALID_PRIORITIES.has(p)) {
            throw new AppError("Invalid priority. Use urgent, high, medium, or low.", 400);
          }
          priority = p;
        }

        let columnId: string | undefined;
        if (flags.column) {
          const col = await resolveColumnOnBoard(boardId, flags.column);
          columnId = col.id;
        }

        let assigneeId: string | null = null;
        if (flags.assignee) {
          if (!context?.teamId) {
            throw new AppError("Active team context is required to assign a member", 400);
          }
          assigneeId = await resolveTeamAssignee(context.teamId, actorId, flags.assignee);
        }

        const labels = flags.label
          ? flags.label
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];

        const ticket = await createTicket(actorId, boardId, {
          title,
          priority,
          columnId,
          assigneeId,
          labels,
        });

        return NextResponse.json({
          ok: true,
          message: `Created ${ticket.key}: ${ticket.title}`,
          ticket,
          boardId: ticket.boardId,
          ticketId: ticket.id,
        });
      }

      case "move": {
        const [rawKey, ...colParts] = positional;
        const ticket = await resolveAccessibleTicketByKey(actorId, rawKey || "", orgId);
        const colName = colParts.join(" ").trim();
        const col = await resolveColumnOnBoard(ticket.boardId, colName);
        const updated = await moveTicket(actorId, ticket.id, { targetColumnId: col.id });
        return NextResponse.json({
          ok: true,
          message: `Moved ${ticket.key} to ${col.name}`,
          ticket: updated,
          boardId: ticket.boardId,
          ticketId: ticket.id,
        });
      }

      case "assign": {
        const [rawKey, ...targetParts] = positional;
        const ticket = await resolveAccessibleTicketByKey(actorId, rawKey || "", orgId);
        const target = targetParts.join(" ").trim();
        const assigneeId = await resolveTeamAssignee(ticket.teamId, actorId, target);
        const updated = await updateTicket(actorId, ticket.id, { assigneeId });
        return NextResponse.json({
          ok: true,
          message: assigneeId
            ? `Updated assignee on ${ticket.key}`
            : `Unassigned ${ticket.key}`,
          ticket: updated,
          boardId: ticket.boardId,
          ticketId: ticket.id,
        });
      }

      case "priority": {
        const [rawKey, rawPriority] = positional;
        const ticket = await resolveAccessibleTicketByKey(actorId, rawKey || "", orgId);
        const p = (rawPriority || "").trim().toLowerCase() as TicketPriority;
        if (!VALID_PRIORITIES.has(p)) {
          throw new AppError("Invalid priority. Use urgent, high, medium, or low.", 400);
        }
        const updated = await updateTicket(actorId, ticket.id, { priority: p });
        return NextResponse.json({
          ok: true,
          message: `Set ${ticket.key} priority to ${p}`,
          ticket: updated,
          boardId: ticket.boardId,
          ticketId: ticket.id,
        });
      }

      case "label": {
        const [rawKey, ...labelParts] = positional;
        const ticket = await resolveAccessibleTicketByKey(actorId, rawKey || "", orgId);
        const expr = labelParts.join(" ").trim();
        if (!expr) {
          throw new AppError("Label argument is required", 400);
        }

        const currentLabels = Array.isArray(ticket.labels) ? [...ticket.labels] : [];
        let nextLabels: string[];
        if (expr.startsWith("-")) {
          const removeName = expr.slice(1).trim().toLowerCase();
          nextLabels = currentLabels.filter((l) => l.toLowerCase() !== removeName);
        } else {
          const addName = expr.startsWith("+") ? expr.slice(1).trim() : expr;
          if (!addName) throw new AppError("Label name cannot be empty", 400);
          const exists = currentLabels.some((l) => l.toLowerCase() === addName.toLowerCase());
          nextLabels = exists ? currentLabels : [...currentLabels, addName];
        }

        const updated = await updateTicket(actorId, ticket.id, { labels: nextLabels });
        return NextResponse.json({
          ok: true,
          message: `Updated labels on ${ticket.key}`,
          ticket: updated,
          boardId: ticket.boardId,
          ticketId: ticket.id,
        });
      }

      case "due": {
        const [rawKey, ...dateParts] = positional;
        const ticket = await resolveAccessibleTicketByKey(actorId, rawKey || "", orgId);
        const dueDate = parseDueDateArg(dateParts.join(" "));
        const updated = await updateTicket(actorId, ticket.id, { dueDate });
        return NextResponse.json({
          ok: true,
          message: dueDate
            ? `Set due date on ${ticket.key} to ${dueDate.toISOString().slice(0, 10)}`
            : `Cleared due date on ${ticket.key}`,
          ticket: updated,
          boardId: ticket.boardId,
          ticketId: ticket.id,
        });
      }

      case "comment": {
        const [rawKey, ...bodyParts] = positional;
        const ticket = await resolveAccessibleTicketByKey(actorId, rawKey || "", orgId);
        const commentBody = bodyParts.join(" ").trim();
        if (!commentBody) {
          throw new AppError("Comment text cannot be empty", 400);
        }
        const comment = await addComment(actorId, ticket.id, { body: commentBody });
        return NextResponse.json({
          ok: true,
          message: `Added comment to ${ticket.key}`,
          comment,
          boardId: ticket.boardId,
          ticketId: ticket.id,
        });
      }

      case "link": {
        const [rawKey, rawUrl] = positional;
        const ticket = await resolveAccessibleTicketByKey(actorId, rawKey || "", orgId);
        const url = (rawUrl || "").trim();
        if (!url) {
          throw new AppError("URL is required", 400);
        }
        const link = await addTicketLink(actorId, ticket.id, { url });
        return NextResponse.json({
          ok: true,
          message: `Linked ${url} to ${ticket.key}`,
          link,
          boardId: ticket.boardId,
          ticketId: ticket.id,
        });
      }

      case "archive": {
        const [rawKey] = positional;
        const ticket = await resolveAccessibleTicketByKey(actorId, rawKey || "", orgId);
        const updated = await archiveTicket(actorId, ticket.id);
        return NextResponse.json({
          ok: true,
          message: `Archived ${ticket.key}`,
          ticket: updated,
          boardId: ticket.boardId,
          ticketId: ticket.id,
          archived: true,
        });
      }

      case "delete": {
        const [rawKey] = positional;
        const ticket = await resolveAccessibleTicketByKey(actorId, rawKey || "", orgId);
        await deleteTicket(actorId, ticket.id);
        return NextResponse.json({
          ok: true,
          message: `Deleted ${ticket.key}`,
          boardId: ticket.boardId,
          ticketId: ticket.id,
          deleted: true,
        });
      }

      case "column": {
        const boardId = context?.boardId;
        if (!boardId) {
          throw new AppError("Select a board before creating a column", 400);
        }
        const name = positional.join(" ").trim();
        if (!name) {
          throw new AppError("Column name is required", 400);
        }
        let wipLimit: number | null = null;
        if (flags.wip) {
          const parsedWip = Number(flags.wip);
          if (!Number.isInteger(parsedWip) || parsedWip < 1) {
            throw new AppError("WIP limit must be a positive integer", 400);
          }
          wipLimit = parsedWip;
        }
        const column = await createColumn(actorId, boardId, { name, wipLimit });
        return NextResponse.json({
          ok: true,
          message: `Created column "${column.name}"`,
          column,
          boardId,
        });
      }

      case "watch": {
        const rawKey = (flags.ticket || positional[0] || "").trim();
        const ticket = rawKey
          ? await resolveAccessibleTicketByKey(actorId, rawKey, orgId)
          : context?.ticketId
          ? (await requireTicketRole(actorId, context.ticketId, "viewer")).ticket
          : (() => {
              throw new AppError("Ticket key is required (or open a ticket first)", 400);
            })();
        const watchStatus = await watchTicket(actorId, ticket.id);
        return NextResponse.json({
          ok: true,
          message: `Watching ${ticket.key}`,
          boardId: ticket.boardId,
          ticketId: ticket.id,
          watchStatus,
        });
      }

      case "unwatch": {
        const rawKey = (flags.ticket || positional[0] || "").trim();
        const ticket = rawKey
          ? await resolveAccessibleTicketByKey(actorId, rawKey, orgId)
          : context?.ticketId
          ? (await requireTicketRole(actorId, context.ticketId, "viewer")).ticket
          : (() => {
              throw new AppError("Ticket key is required (or open a ticket first)", 400);
            })();
        const watchStatus = await unwatchTicket(actorId, ticket.id);
        return NextResponse.json({
          ok: true,
          message: `Stopped watching ${ticket.key}`,
          boardId: ticket.boardId,
          ticketId: ticket.id,
          watchStatus,
        });
      }

      case "mute": {
        const rawKey = (flags.ticket || positional[0] || "").trim();
        const ticket = rawKey
          ? await resolveAccessibleTicketByKey(actorId, rawKey, orgId)
          : context?.ticketId
          ? (await requireTicketRole(actorId, context.ticketId, "viewer")).ticket
          : (() => {
              throw new AppError("Ticket key is required (or open a ticket first)", 400);
            })();
        const current = await getTicketWatchStatus(actorId, ticket.id);
        const nextMuted = !current.muted;
        const watchStatus = await setTicketMute(actorId, ticket.id, nextMuted);
        return NextResponse.json({
          ok: true,
          message: nextMuted ? `Muted updates for ${ticket.key}` : `Unmuted updates for ${ticket.key}`,
          boardId: ticket.boardId,
          ticketId: ticket.id,
          watchStatus,
        });
      }

      case "read-all": {
        const updated = await markAllNotificationsRead(actorId);
        return NextResponse.json({
          ok: true,
          message: `Marked ${updated} notification${updated === 1 ? "" : "s"} as read`,
          updated,
        });
      }

      default:
        throw new AppError(`Unhandled command: /${def.name}`, 400);
    }
  } catch (err) {
    return handleApiError(err);
  }
}
