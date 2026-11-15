import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { getTicketFullDetails, updateTicket, deleteTicket } from "@/lib/tickets";
import { getAttachmentDownloadUrl } from "@/lib/attachments";
import type { TicketPriority } from "@/db/schema";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ ticketId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req, { skipCsrf: true });
    const { ticketId } = await context.params;
    const details = await getTicketFullDetails(auth.user.id, ticketId);

    const attachmentsWithUrls = await Promise.all(
      details.attachments.map(async (att) => ({
        ...att,
        downloadUrl: await getAttachmentDownloadUrl(auth.user.id, att.id),
      }))
    );

    return NextResponse.json({
      ...details,
      attachments: attachmentsWithUrls,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ ticketId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { ticketId } = await context.params;
    const body = await req.json();
    const ticket = await updateTicket(auth.user.id, ticketId, {
      title: body.title !== undefined ? String(body.title) : undefined,
      description: body.description !== undefined ? String(body.description) : undefined,
      priority: body.priority !== undefined ? (body.priority as TicketPriority) : undefined,
      labels: Array.isArray(body.labels) ? body.labels.map(String) : undefined,
      assigneeId:
        body.assigneeId !== undefined
          ? body.assigneeId
            ? String(body.assigneeId)
            : null
          : undefined,
      dueDate:
        body.dueDate !== undefined
          ? body.dueDate
            ? new Date(body.dueDate)
            : null
          : undefined,
    });
    return NextResponse.json({ ticket });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ ticketId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { ticketId } = await context.params;
    await deleteTicket(auth.user.id, ticketId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

