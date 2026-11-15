import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { createTicket } from "@/lib/tickets";
import type { TicketPriority } from "@/db/schema";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ boardId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { boardId } = await context.params;
    const body = await req.json();
    const ticket = await createTicket(auth.user.id, boardId, {
      columnId: body.columnId ? String(body.columnId) : undefined,
      title: String(body.title || ""),
      description: body.description ? String(body.description) : undefined,
      priority: (body.priority || "medium") as TicketPriority,
      labels: Array.isArray(body.labels) ? body.labels.map(String) : [],
      assigneeId: body.assigneeId ? String(body.assigneeId) : null,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
    });
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

