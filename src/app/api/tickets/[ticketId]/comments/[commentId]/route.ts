import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { editComment } from "@/lib/comments";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ ticketId: string; commentId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { ticketId, commentId } = await context.params;
    const body = await req.json();
    const comment = await editComment(auth.user.id, ticketId, commentId, {
      body: String(body.body || ""),
    });
    return NextResponse.json({ comment });
  } catch (err) {
    return handleApiError(err);
  }
}
