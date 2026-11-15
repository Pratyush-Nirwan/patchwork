import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req, {
      skipCsrf: true,
      allowMustChangePassword: true,
    });
    return NextResponse.json({
      user: auth.user,
      csrfToken: auth.session.csrfToken,
      expiresAt: auth.session.expiresAt,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

