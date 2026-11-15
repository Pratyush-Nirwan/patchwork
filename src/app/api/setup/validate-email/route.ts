import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/db";
import { normalizeEmail, isValidEmailFormat, checkEmailAvailability } from "@/lib/email";
import { handleApiError } from "@/lib/http";
import { db } from "@/db";
import { setupState } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    await ensureMigrated();
    const url = new URL(req.url);
    const rawEmail = url.searchParams.get("email") || "";
    const excludeUserId = url.searchParams.get("excludeUserId");

    const normalized = normalizeEmail(rawEmail);
    if (!normalized) {
      return NextResponse.json({
        available: false,
        normalized: "",
        message: "Email is required",
      });
    }

    if (!isValidEmailFormat(normalized)) {
      return NextResponse.json({
        available: false,
        normalized,
        message: "Invalid email format",
      });
    }

    // Check against setup draft admin email if available
    const [state] = await db
      .select()
      .from(setupState)
      .where(eq(setupState.id, "default"))
      .limit(1);

    if (state?.draftData?.admin?.email) {
      const adminEmail = normalizeEmail(state.draftData.admin.email);
      if (adminEmail === normalized && excludeUserId !== state.adminUserId) {
        const adminName = state.draftData.admin.name || "Setup Admin";
        return NextResponse.json({
          available: false,
          normalized,
          usedBy: adminName,
          message: `This email is already used by ${adminName}.`,
        });
      }
    }

    const check = await checkEmailAvailability(normalized, excludeUserId);
    if (!check.available) {
      return NextResponse.json({
        available: false,
        normalized,
        usedBy: check.usedBy,
        message: `This email is already used by ${check.usedBy || "another user"}.`,
      });
    }

    return NextResponse.json({
      available: true,
      normalized,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
