import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { addComment } from "@/lib/comments";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ ticketId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { ticketId } = await context.params;
    const body = await req.json();
    const comment = await addComment(auth.user.id, ticketId, {
      body: String(body.body || ""),
    });
    return NextResponse.json({ comment }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

