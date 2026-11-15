import { NextRequest } from "next/server";
import { eq, and, count } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  orgs,
  orgMembers,
  teamMembers,
  projects,
  boards,
  columns,
  tickets,
  ticketComments,
  ticketAttachments,
} from "@/db/schema";
import { requireRequestAuth } from "./http";
import { ForbiddenError, NotFoundError } from "./errors";
import { AuthContext } from "./auth";

export interface AdminAuthResult {
  auth: AuthContext;
  orgId: string;
  org: typeof orgs.$inferSelect;
}

export async function requireAdminAuth(req: NextRequest): Promise<AdminAuthResult> {
  const auth = await requireRequestAuth(req);

  // Determine orgId from header, query param, or first admin org
  let orgId =
    req.headers.get("x-org-id") ||
    req.nextUrl.searchParams.get("orgId") ||
    "";

  if (!orgId) {
    const adminOrgs = await db
      .select({ orgId: orgMembers.orgId })
      .from(orgMembers)
      .where(and(eq(orgMembers.userId, auth.user.id), eq(orgMembers.role, "admin")))
      .limit(1);

    if (adminOrgs.length > 0) {
      orgId = adminOrgs[0].orgId;
    }
  }

  if (!orgId) {
    throw new ForbiddenError("Organization admin role required");
  }

  const [membership] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, auth.user.id)))
    .limit(1);

  if (!membership || membership.role !== "admin") {
    throw new ForbiddenError("Organization admin role required");
  }

  const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
  if (!org) {
    throw new NotFoundError("Organization not found");
  }

  return { auth, orgId, org };
}

export async function isLastAdmin(userId: string, orgId: string): Promise<boolean> {
  const adminRows = await db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, "admin")));

  return adminRows.length === 1 && adminRows[0].userId === userId;
}

const DELETED_USER_EMAIL = "deleted-user@invalid.local";

export async function getOrCreateDeletedUser(): Promise<string> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, DELETED_USER_EMAIL))
    .limit(1);

  if (existing) return existing.id;

  const [created] = await db
    .insert(users)
    .values({
      email: DELETED_USER_EMAIL,
      name: "Deleted User",
      passwordHash: "ACCOUNT_DELETED",
      isDeactivated: true,
      mustChangePassword: true,
      isSetupAdmin: false,
    })
    .returning({ id: users.id });

  return created.id;
}

export async function getUserDependencies(userId: string, orgId: string) {
  const [assignedTickets] = await db
    .select({ count: count() })
    .from(tickets)
    .where(and(eq(tickets.orgId, orgId), eq(tickets.assigneeId, userId)));

  const [reportedTickets] = await db
    .select({ count: count() })
    .from(tickets)
    .where(and(eq(tickets.orgId, orgId), eq(tickets.reporterId, userId)));

  const [userComments] = await db
    .select({ count: count() })
    .from(ticketComments)
    .where(and(eq(ticketComments.orgId, orgId), eq(ticketComments.authorId, userId)));

  const [userAttachments] = await db
    .select({ count: count() })
    .from(ticketAttachments)
    .where(and(eq(ticketAttachments.orgId, orgId), eq(ticketAttachments.uploaderId, userId)));

  return {
    assignedTicketsCount: Number(assignedTickets?.count || 0),
    reportedTicketsCount: Number(reportedTickets?.count || 0),
    commentsCount: Number(userComments?.count || 0),
    attachmentsCount: Number(userAttachments?.count || 0),
  };
}

export async function getTeamDependencies(teamId: string) {
  const [projectsCount] = await db
    .select({ count: count() })
    .from(projects)
    .where(eq(projects.teamId, teamId));

  const [boardsCount] = await db
    .select({ count: count() })
    .from(boards)
    .where(eq(boards.teamId, teamId));

  const [ticketsCount] = await db
    .select({ count: count() })
    .from(tickets)
    .where(eq(tickets.teamId, teamId));

  const [membersCount] = await db
    .select({ count: count() })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId));

  return {
    projectsCount: Number(projectsCount?.count || 0),
    boardsCount: Number(boardsCount?.count || 0),
    ticketsCount: Number(ticketsCount?.count || 0),
    membersCount: Number(membersCount?.count || 0),
  };
}

export async function getProjectDependencies(projectId: string) {
  const [boardsCount] = await db
    .select({ count: count() })
    .from(boards)
    .where(eq(boards.projectId, projectId));

  const [ticketsCount] = await db
    .select({ count: count() })
    .from(tickets)
    .where(eq(tickets.projectId, projectId));

  return {
    boardsCount: Number(boardsCount?.count || 0),
    ticketsCount: Number(ticketsCount?.count || 0),
  };
}

export async function getBoardDependencies(boardId: string) {
  const [columnsCount] = await db
    .select({ count: count() })
    .from(columns)
    .where(eq(columns.boardId, boardId));

  const [ticketsCount] = await db
    .select({ count: count() })
    .from(tickets)
    .where(eq(tickets.boardId, boardId));

  return {
    columnsCount: Number(columnsCount?.count || 0),
    ticketsCount: Number(ticketsCount?.count || 0),
  };
}
