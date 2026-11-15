import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/db";
import { users, orgMembers, teamMembers, sessions } from "@/db/schema";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth, isLastAdmin } from "@/lib/system";
import { AppError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    const { auth, orgId } = await requireAdminAuth(req);
    const body = await req.json();

    const userIds = Array.isArray(body.userIds) ? (body.userIds as string[]) : [];
    const action = String(body.action || "");

    if (userIds.length === 0) {
      throw new AppError("No user IDs provided", 400, "NO_USERS_SELECTED");
    }

    let affectedCount = 0;

    if (action === "force-signout") {
      await db.delete(sessions).where(inArray(sessions.userId, userIds));
      affectedCount = userIds.length;
    } else if (action === "deactivate") {
      for (const targetId of userIds) {
        if (targetId === auth.user.id) continue; // Skip self
        if (await isLastAdmin(targetId, orgId)) continue; // Skip last admin

        await db
          .update(users)
          .set({ isDeactivated: true })
          .where(eq(users.id, targetId));
        await db.delete(sessions).where(eq(sessions.userId, targetId));
        affectedCount++;
      }
    } else if (action === "change-role") {
      const newRole = body.role as "admin" | "member";
      if (!["admin", "member"].includes(newRole)) {
        throw new AppError("Invalid role", 400, "INVALID_ROLE");
      }

      for (const targetId of userIds) {
        if (targetId === auth.user.id && newRole !== "admin") continue; // Prevent self-demote
        if (newRole !== "admin" && (await isLastAdmin(targetId, orgId))) continue; // Prevent last admin demote

        await db
          .update(orgMembers)
          .set({ role: newRole })
          .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetId)));
        affectedCount++;
      }
    } else if (action === "assign-team") {
      const teamId = String(body.teamId || "");
      const teamRole = (body.teamRole || "member") as "lead" | "member" | "viewer";
      if (!teamId) {
        throw new AppError("Team ID is required", 400, "INVALID_TEAM");
      }

      for (const targetId of userIds) {
        await db
          .insert(teamMembers)
          .values({
            teamId,
            userId: targetId,
            role: teamRole,
          })
          .onConflictDoNothing();
        affectedCount++;
      }
    } else {
      throw new AppError("Unsupported bulk action", 400, "INVALID_ACTION");
    }

    return NextResponse.json({
      success: true,
      action,
      affectedCount,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

