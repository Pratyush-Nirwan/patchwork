import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ticketComments, users } from "@/db/schema";
import { requireTicketRole } from "./rbac";
import { AppError } from "./errors";
import { recordActivity } from "./tickets";
import { realtimeHub } from "./realtime";

export async function addComment(
  actorId: string,
  ticketId: string,
  input: { body: string }
) {
  const { ticket } = await requireTicketRole(actorId, ticketId, "member");
  const body = input.body.trim();
  if (!body) {
    throw new AppError("Comment body cannot be empty", 400);
  }

  const [comment] = await db
    .insert(ticketComments)
    .values({
      ticketId: ticket.id,
      orgId: ticket.orgId,
      teamId: ticket.teamId,
      authorId: actorId,
      body,
    })
    .returning();

  const [author] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, actorId))
    .limit(1);

  await recordActivity({
    ticketId: ticket.id,
    actorId,
    action: "comment.added",
    details: {
      commentId: comment.id,
      preview: body.slice(0, 120),
    },
  });

  const enriched = {
    ...comment,
    author,
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


