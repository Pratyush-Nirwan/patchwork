import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { requireTicketRole } from "@/lib/rbac";
import { presenceHub } from "@/lib/presence";
import { AppError } from "@/lib/errors";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ ticketId: string }> }
) {
  try {
    const rawText = await req.text();
    let body: Record<string, unknown> = {};
    try {
      body = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
    } catch {
      body = {};
    }

    const state = body.state;
    if (state !== "view" && state !== "typing" && state !== "leave") {
      throw new AppError("Invalid presence state", 400);
    }
    const tabId =
      typeof body.tabId === "string" && body.tabId.trim()
        ? body.tabId.trim().slice(0, 64)
        : "default";

    // sendBeacon cannot send custom CSRF headers, so allow skipCsrf on leave only
    const auth = await requireRequestAuth(req, {
      skipCsrf: state === "leave",
      skipTouch: true,
    });
    const { ticketId } = await context.params;
    const { ticket } = await requireTicketRole(auth.user.id, ticketId, "viewer");

    const snapshot = await presenceHub.publishHeartbeat({
      ticketId: ticket.id,
      orgId: ticket.orgId,
      teamId: ticket.teamId,
      userId: auth.user.id,
      name: auth.user.name,
      tabId,
      state,
    });

    return NextResponse.json(snapshot);
  } catch (err) {
    return handleApiError(err);
  }
}
