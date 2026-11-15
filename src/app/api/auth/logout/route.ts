import { NextRequest, NextResponse } from "next/server";
import { invalidateSession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { clearAuthCookies, handleApiError, requireRequestAuth } from "@/lib/http";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req, {
      allowMustChangePassword: true,
    });
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value || auth.session.id;
    await invalidateSession(token);
    const res = NextResponse.json({ ok: true });
    return clearAuthCookies(res);
  } catch (err) {
    return handleApiError(err);
  }
}

