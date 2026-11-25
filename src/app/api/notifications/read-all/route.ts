import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { markAllNotificationsRead } from "@/lib/notifications";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    const updated = await markAllNotificationsRead(auth.user.id);
    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    return handleApiError(err);
  }
}
