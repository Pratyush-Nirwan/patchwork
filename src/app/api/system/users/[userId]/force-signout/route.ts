import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    await requireAdminAuth(req);
    const { userId } = await params;

    await db.delete(sessions).where(eq(sessions.userId, userId));

    return NextResponse.json({
      success: true,
      message: "User sessions revoked",
    });
  } catch (err) {
    return handleApiError(err);
  }
}

