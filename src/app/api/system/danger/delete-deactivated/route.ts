import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  orgMembers,
  teamMembers,
  tickets,
  ticketComments,
  ticketActivities,
  sessions,
} from "@/db/schema";
import { handleApiError } from "@/lib/http";
import {
  requireAdminAuth,
  getOrCreateDeletedUser,
  isLastAdmin,
} from "@/lib/system";
import { AppError } from "@/lib/errors";

export async function GET(req: NextRequest) {
  try {
    const { orgId } = await requireAdminAuth(req);

    const deactivated = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        createdAt: users.createdAt,
      })
      .from(users)
      .innerJoin(orgMembers, eq(orgMembers.userId, users.id))
      .where(and(eq(orgMembers.orgId, orgId), eq(users.isDeactivated, true)));

    return NextResponse.json({
      count: deactivated.length,
      users: deactivated,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { auth, orgId } = await requireAdminAuth(req);
    const body = await req.json();

    const confirmText = String(body.confirmText || "").trim();
    if (confirmText !== "DELETE DEACTIVATED") {
      throw new AppError(
        'Confirmation text must match "DELETE DEACTIVATED"',
        400,
        "INVALID_CONFIRMATION"
      );
    }

    const deactivatedRows = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(orgMembers, eq(orgMembers.userId, users.id))
      .where(and(eq(orgMembers.orgId, orgId), eq(users.isDeactivated, true)));

    const placeholderId = await getOrCreateDeletedUser();
    let deletedCount = 0;

    for (const r of deactivatedRows) {
      if (r.id === auth.user.id) continue;
      if (r.id === placeholderId) continue;
      if (await isLastAdmin(r.id, orgId)) continue;

      // Reassign comments & activities to placeholder
      await db
        .update(ticketComments)
        .set({ authorId: placeholderId })
        .where(eq(ticketComments.authorId, r.id));

      await db
        .update(ticketActivities)
        .set({ actorId: placeholderId })
        .where(eq(ticketActivities.actorId, r.id));

      // Unassign tickets
      await db
        .update(tickets)
        .set({ assigneeId: null })
        .where(eq(tickets.assigneeId, r.id));

      await db
        .update(tickets)
        .set({ reporterId: null })
        .where(eq(tickets.reporterId, r.id));

      // Delete sessions, memberships, and user
      await db.delete(sessions).where(eq(sessions.userId, r.id));
      await db.delete(teamMembers).where(eq(teamMembers.userId, r.id));
      await db.delete(orgMembers).where(eq(orgMembers.userId, r.id));
      await db.delete(users).where(eq(users.id, r.id));

      deletedCount++;
    }

    return NextResponse.json({
      success: true,
      deletedCount,
      message: `Permanently deleted ${deletedCount} deactivated users`,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
