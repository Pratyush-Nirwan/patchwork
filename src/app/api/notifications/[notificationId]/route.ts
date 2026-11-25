import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { archiveNotification, markNotificationRead } from "@/lib/notifications";
import { AppError } from "@/lib/errors";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ notificationId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { notificationId } = await context.params;
    const body = await req.json();

    if (typeof body.archive === "boolean") {
      await archiveNotification(auth.user.id, notificationId, body.archive);
      return NextResponse.json({ ok: true });
    }
    if (typeof body.read === "boolean") {
      await markNotificationRead(auth.user.id, notificationId, body.read);
      return NextResponse.json({ ok: true });
    }
    throw new AppError("Provide 'read' (boolean) or 'archive: true'", 400);
  } catch (err) {
    return handleApiError(err);
  }
}
