import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, sessions, setupCredentials } from "@/db/schema";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import { hashPassword, validatePasswordAgainstPolicy } from "@/lib/auth";
import { generateSystemPassword, generateCryptoPassword } from "@/lib/setup";
import { NotFoundError } from "@/lib/errors";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    await requireAdminAuth(req);
    const { userId } = await params;
    const body = await req.json();

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    const passwordOption = body.passwordOption || "system"; // "system" | "random" | "custom"
    let newPassword = "";
    if (passwordOption === "system") {
      newPassword = generateSystemPassword(user.name);
    } else if (passwordOption === "random") {
      newPassword = generateCryptoPassword(16);
    } else {
      newPassword = String(body.customPassword || "");
    }

    await validatePasswordAgainstPolicy(newPassword);
    const passwordHash = await hashPassword(newPassword);

    await db
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: true,
      })
      .where(eq(users.id, userId));

    // Clear any old sessions so they must sign in again
    await db.delete(sessions).where(eq(sessions.userId, userId));
    await db.delete(setupCredentials).where(eq(setupCredentials.userId, userId));

    return NextResponse.json({
      success: true,
      generatedPassword: newPassword,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

