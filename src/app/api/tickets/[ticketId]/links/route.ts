import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { addTicketLink } from "@/lib/links";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ ticketId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { ticketId } = await context.params;
    const body = await req.json();
    const link = await addTicketLink(auth.user.id, ticketId, {
      url: String(body.url || ""),
    });
    return NextResponse.json({ link }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

