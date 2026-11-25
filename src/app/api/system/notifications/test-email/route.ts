import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import { sendTestEmail } from "@/lib/email-notifications";
import { isValidEmailFormat } from "@/lib/email";
import { AppError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    const { auth } = await requireAdminAuth(req);
    const body = await req.json().catch(() => ({}));
    const to = typeof body.to === "string" && body.to.trim() ? body.to.trim() : auth.user.email;
    if (!isValidEmailFormat(to)) {
      throw new AppError("Valid recipient email address is required", 400);
    }
    const res = await sendTestEmail(to);
    return NextResponse.json(res, { status: res.ok ? 200 : 502 });
  } catch (err) {
    return handleApiError(err);
  }
}
