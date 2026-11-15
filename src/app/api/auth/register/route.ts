import { NextRequest, NextResponse } from "next/server";
import { registerUser } from "@/lib/auth";
import { attachAuthCookies, handleApiError } from "@/lib/http";
import { db, ensureMigrated } from "@/db";
import { setupState } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}

export async function POST(req: NextRequest) {
  try {
    await ensureMigrated();
    const [state] = await db
      .select({ isCompleted: setupState.isCompleted })
      .from(setupState)
      .where(eq(setupState.id, "default"))
      .limit(1);

    if (state?.isCompleted) {
      return NextResponse.json(
        {
          error: "registration_closed",
          message: "Public registration is disabled. Contact your administrator.",
        },
        { status: 403 }
      );
    }

    const body = await req.json();
    const auth = await registerUser({
      email: String(body.email || ""),
      password: String(body.password || ""),
      name: String(body.name || ""),
      isPublicRegistration: true,
    });

    const res = NextResponse.json(
      {
        user: auth.user,
        csrfToken: auth.session.csrfToken,
        expiresAt: auth.session.expiresAt,
      },
      { status: 201 }
    );
    return attachAuthCookies(res, auth);
  } catch (err) {
    return handleApiError(err);
  }
}

