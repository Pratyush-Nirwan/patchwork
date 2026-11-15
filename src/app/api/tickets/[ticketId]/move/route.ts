import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { moveTicket } from "@/lib/tickets";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ ticketId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { ticketId } = await context.params;
    const body = await req.json();
    const ticket = await moveTicket(auth.user.id, ticketId, {
      targetColumnId: String(body.targetColumnId || body.columnId || ""),
      targetPosition:
        body.targetPosition !== undefined
          ? Number(body.targetPosition)
          : body.position !== undefined
          ? Number(body.position)
          : undefined,
    });
    return NextResponse.json({ ticket });
  } catch (err) {
    return handleApiError(err);
  }
}

