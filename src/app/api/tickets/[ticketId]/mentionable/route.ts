import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { requireTicketRole } from "@/lib/rbac";
import { listMentionableUsers } from "@/lib/mentions";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ ticketId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req, { skipCsrf: true });
    const { ticketId } = await context.params;
    const { ticket } = await requireTicketRole(auth.user.id, ticketId, "viewer");
    const q = req.nextUrl.searchParams.get("q") || undefined;
    const users = await listMentionableUsers(
      { orgId: ticket.orgId, teamId: ticket.teamId },
      q
    );
    return NextResponse.json({ users });
  } catch (err) {
    return handleApiError(err);
  }
}
