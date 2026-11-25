import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import {
  getTicketWatchStatus,
  listTicketWatchers,
  setTicketMute,
  unwatchTicket,
  watchTicket,
} from "@/lib/watchers";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ ticketId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req, { skipCsrf: true });
    const { ticketId } = await context.params;
    const limitParam = req.nextUrl.searchParams.get("limit");
    const offsetParam = req.nextUrl.searchParams.get("offset");
    if (limitParam !== null || offsetParam !== null) {
      const page = await listTicketWatchers(auth.user.id, ticketId, {
        limit: limitParam ? Number(limitParam) : 20,
        offset: offsetParam ? Number(offsetParam) : 0,
      });
      return NextResponse.json(page);
    }
    const status = await getTicketWatchStatus(auth.user.id, ticketId);
    return NextResponse.json(status);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ ticketId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { ticketId } = await context.params;
    const body = await req.json().catch(() => ({}));
    if (typeof body.muted === "boolean") {
      const status = await setTicketMute(auth.user.id, ticketId, body.muted);
      return NextResponse.json(status);
    }
    const status = await watchTicket(auth.user.id, ticketId);
    return NextResponse.json(status);
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
    const status = await unwatchTicket(auth.user.id, ticketId);
    return NextResponse.json(status);
  } catch (err) {
    return handleApiError(err);
  }
}
