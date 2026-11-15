import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { orgMembers } from "@/db/schema";
import { requireRequestAuth } from "@/lib/http";
import { AppError } from "@/lib/errors";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req, { skipCsrf: true, skipTouch: true });

    const orgId = req.headers.get("x-org-id") || req.nextUrl.searchParams.get("orgId");
    let adminMembership;

    if (orgId) {
      [adminMembership] = await db
        .select()
        .from(orgMembers)
        .where(
          and(
            eq(orgMembers.userId, auth.user.id),
            eq(orgMembers.orgId, orgId),
            eq(orgMembers.role, "admin")
          )
        )
        .limit(1);
    } else {
      [adminMembership] = await db
        .select()
        .from(orgMembers)
        .where(
          and(
            eq(orgMembers.userId, auth.user.id),
            eq(orgMembers.role, "admin")
          )
        )
        .limit(1);
    }

    if (!adminMembership) {
      return NextResponse.json(
        { error: "Forbidden: Organization admin role required" },
        { status: 403 }
      );
    }

    return NextResponse.json({
      isAdmin: true,
      orgId: adminMembership.orgId,
      userId: auth.user.id,
    });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: "Unauthorized: Authentication required", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }
}
