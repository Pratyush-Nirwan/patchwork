import { NextRequest, NextResponse } from "next/server";
import { changeUserPassword } from "@/lib/auth";
import { handleApiError, requireRequestAuth } from "@/lib/http";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req, {
      allowMustChangePassword: true,
    });
    const body = await req.json();
    const user = await changeUserPassword(auth.user.id, {
      currentPassword:
        body.currentPassword !== undefined
          ? String(body.currentPassword)
          : undefined,
      newPassword: String(body.newPassword || ""),
    });
    return NextResponse.json({ user });
  } catch (err) {
    return handleApiError(err);
  }
}

