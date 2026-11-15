import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  orgMembers,
  teamMembers,
  teams,
  tickets,
  ticketComments,
  ticketActivities,
  sessions,
} from "@/db/schema";
import { handleApiError } from "@/lib/http";
import {
  requireAdminAuth,
  isLastAdmin,
  getOrCreateDeletedUser,
  getUserDependencies,
} from "@/lib/system";
import { normalizeEmail, isValidEmailFormat, EmailTakenError } from "@/lib/email";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { orgId } = await requireAdminAuth(req);
    const { userId } = await params;

    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        isDeactivated: users.isDeactivated,
        mustChangePassword: users.mustChangePassword,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new NotFoundError("User not found");
    }

    const [membership] = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
      .limit(1);

    if (!membership) {
      throw new NotFoundError("User is not a member of this organization");
    }

    const dependencies = await getUserDependencies(userId, orgId);

    const userTeams = await db
      .select({
        teamId: teams.id,
        teamName: teams.name,
        role: teamMembers.role,
        subRole: teamMembers.subRole,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teams.orgId, orgId), eq(teamMembers.userId, userId)));

    return NextResponse.json({
      user: {
        ...user,
        role: membership.role,
        status: user.isDeactivated ? "deactivated" : "active",
        teams: userTeams,
      },
      dependencies,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { auth, orgId } = await requireAdminAuth(req);
    const { userId } = await params;
    const body = await req.json();

    const [targetUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!targetUser) {
      throw new NotFoundError("User not found");
    }

    const [membership] = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
      .limit(1);

    if (!membership) {
      throw new NotFoundError("User is not a member of this organization");
    }

    const isSelf = auth.user.id === userId;
    const isTargetLastAdmin = await isLastAdmin(userId, orgId);

    // Deactivation guard
    if (typeof body.isDeactivated === "boolean") {
      if (body.isDeactivated) {
        if (isSelf) {
          throw new ForbiddenError("You cannot deactivate your own account");
        }
        if (isTargetLastAdmin) {
          throw new ForbiddenError(
            "Cannot deactivate the only remaining organization administrator"
          );
        }
      }
    }

    // Role guard
    if (body.role && body.role !== membership.role) {
      if (isSelf && body.role !== "admin") {
        throw new ForbiddenError("You cannot demote your own account");
      }
      if (isTargetLastAdmin && body.role !== "admin") {
        throw new ForbiddenError(
          "Cannot demote the only remaining organization administrator"
        );
      }
    }

    // Name & Email updates
    const updates: Partial<typeof users.$inferInsert> = {};
    if (typeof body.name === "string" && body.name.trim()) {
      updates.name = body.name.trim();
    }

    if (typeof body.email === "string" && body.email.trim()) {
      const normalized = normalizeEmail(body.email.trim());
      if (!isValidEmailFormat(normalized)) {
        throw new AppError("Invalid email format", 400, "INVALID_EMAIL");
      }
      if (normalized !== targetUser.email.toLowerCase()) {
        const [existing] = await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(sql`lower(${users.email}) = lower(${normalized})`)
          .limit(1);

        if (existing && existing.id !== userId) {
          throw new EmailTakenError(
            `This email is already used by ${existing.name}.`,
            existing.name
          );
        }
        updates.email = normalized;
      }
    }

    if (typeof body.isDeactivated === "boolean") {
      updates.isDeactivated = body.isDeactivated;
      if (body.isDeactivated) {
        // Revoke active sessions immediately
        await db.delete(sessions).where(eq(sessions.userId, userId));
      }
    }

    if (Object.keys(updates).length > 0) {
      await db.update(users).set(updates).where(eq(users.id, userId));
    }

    if (body.role && ["admin", "member"].includes(body.role)) {
      await db
        .update(orgMembers)
        .set({ role: body.role })
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
    }

    // Teams update
    if (Array.isArray(body.teams)) {
      const orgTeamRows = await db
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.orgId, orgId));
      const orgTeamIds = orgTeamRows.map((t) => t.id);

      if (orgTeamIds.length > 0) {
        await db
          .delete(teamMembers)
          .where(
            and(
              eq(teamMembers.userId, userId),
              sql`${teamMembers.teamId} IN ${orgTeamIds}`
            )
          );
      }

      for (const t of body.teams) {
        const teamRole = t.role || "member";
        if (
          t.teamId &&
          orgTeamIds.includes(t.teamId) &&
          ["lead", "member", "viewer"].includes(teamRole)
        ) {
          const validSubRoles = ["developer", "tester", "designer", "devops", "general"];
          const subRole = teamRole === "member"
            ? (validSubRoles.includes(t.subRole) ? t.subRole : "developer")
            : null;
          await db
            .insert(teamMembers)
            .values({
              teamId: t.teamId,
              userId,
              role: teamRole,
              subRole,
            })
            .onConflictDoNothing();
        }
      }
    }

    const [updatedUser] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        isDeactivated: users.isDeactivated,
        mustChangePassword: users.mustChangePassword,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return NextResponse.json({
      user: {
        ...updatedUser,
        role: body.role || membership.role,
        status: updatedUser.isDeactivated ? "deactivated" : "active",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { auth, orgId } = await requireAdminAuth(req);
    const { userId } = await params;
    const searchParams = req.nextUrl.searchParams;
    const mode = searchParams.get("mode") || "deactivate"; // "deactivate" | "hard"

    const [targetUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!targetUser) {
      throw new NotFoundError("User not found");
    }

    const isSelf = auth.user.id === userId;
    const isTargetLastAdmin = await isLastAdmin(userId, orgId);

    if (isSelf) {
      throw new ForbiddenError("You cannot delete your own account");
    }
    if (isTargetLastAdmin) {
      throw new ForbiddenError(
        "Cannot delete the only remaining organization administrator"
      );
    }

    if (mode === "deactivate") {
      await db
        .update(users)
        .set({ isDeactivated: true })
        .where(eq(users.id, userId));
      await db.delete(sessions).where(eq(sessions.userId, userId));
      return NextResponse.json({
        success: true,
        action: "deactivated",
        userId,
      });
    }

    // Hard delete
    let body: { confirmEmail?: string; reassignToUserId?: string | null } = {};
    try {
      body = await req.json();
    } catch {
      // ignore
    }

    const confirmEmail = normalizeEmail(String(body.confirmEmail || ""));
    if (confirmEmail !== targetUser.email.toLowerCase()) {
      throw new AppError(
        "Confirmation email does not match user email",
        400,
        "EMAIL_MISMATCH"
      );
    }

    // Reassign or unassign tickets
    if (body.reassignToUserId) {
      const [newAssignee] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, body.reassignToUserId))
        .limit(1);
      if (newAssignee) {
        await db
          .update(tickets)
          .set({ assigneeId: newAssignee.id })
          .where(and(eq(tickets.orgId, orgId), eq(tickets.assigneeId, userId)));
      } else {
        await db
          .update(tickets)
          .set({ assigneeId: null })
          .where(and(eq(tickets.orgId, orgId), eq(tickets.assigneeId, userId)));
      }
    } else {
      await db
        .update(tickets)
        .set({ assigneeId: null })
        .where(and(eq(tickets.orgId, orgId), eq(tickets.assigneeId, userId)));
    }

    // Preserve comments and activities by reassigning to placeholder user
    const deletedUserPlaceholderId = await getOrCreateDeletedUser();
    await db
      .update(ticketComments)
      .set({ authorId: deletedUserPlaceholderId })
      .where(and(eq(ticketComments.orgId, orgId), eq(ticketComments.authorId, userId)));

    await db
      .update(ticketActivities)
      .set({ actorId: deletedUserPlaceholderId })
      .where(eq(ticketActivities.actorId, userId));

    // Clear reporterId on tickets
    await db
      .update(tickets)
      .set({ reporterId: null })
      .where(and(eq(tickets.orgId, orgId), eq(tickets.reporterId, userId)));

    // Clear sessions, memberships, and user
    await db.delete(sessions).where(eq(sessions.userId, userId));
    await db.delete(orgMembers).where(eq(orgMembers.userId, userId));
    await db.delete(teamMembers).where(eq(teamMembers.userId, userId));
    await db.delete(users).where(eq(users.id, userId));

    return NextResponse.json({
      success: true,
      action: "deleted",
      userId,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
