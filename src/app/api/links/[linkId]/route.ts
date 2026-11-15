import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { removeTicketLink } from "@/lib/links";

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ linkId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { linkId } = await context.params;
    await removeTicketLink(auth.user.id, linkId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

