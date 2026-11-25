import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { listNotifications, type NotificationTab } from "@/lib/notifications";

const VALID_TABS = new Set<NotificationTab>([
  "all",
  "unread",
  "mentions",
  "assigned",
  "watching",
  "archived",
]);

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req, { skipCsrf: true });
    const rawTab = req.nextUrl.searchParams.get("tab") || "all";
    const tab: NotificationTab = VALID_TABS.has(rawTab as NotificationTab)
      ? (rawTab as NotificationTab)
      : "all";
    const cursor = req.nextUrl.searchParams.get("cursor");
    const limitParam = req.nextUrl.searchParams.get("limit");
    const q = req.nextUrl.searchParams.get("q") || undefined;

    const result = await listNotifications(auth.user.id, {
      tab,
      cursor,
      limit: limitParam ? Number(limitParam) : 25,
      q,
    });
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
