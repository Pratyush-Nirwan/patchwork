import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import { listEmailDeliveryLog } from "@/lib/email-notifications";

export async function GET(req: NextRequest) {
  try {
    await requireAdminAuth(req);
    const limitParam = req.nextUrl.searchParams.get("limit");
    const logs = await listEmailDeliveryLog(limitParam ? Number(limitParam) : 50);
    return NextResponse.json({ logs });
  } catch (err) {
    return handleApiError(err);
  }
}
