import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  orgMembers,
  teams,
  projects,
  boards,
  columns,
  tickets,
  ticketComments,
} from "@/db/schema";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import { getSystemSetting } from "@/lib/settings";

export async function GET(req: NextRequest) {
  try {
    const { orgId, org } = await requireAdminAuth(req);
    const format = req.nextUrl.searchParams.get("format") || "json";

    // 1. Fetch Users in Org (without passwords)
    const orgUsers = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: orgMembers.role,
        isDeactivated: users.isDeactivated,
        createdAt: users.createdAt,
      })
      .from(users)
      .innerJoin(orgMembers, eq(orgMembers.userId, users.id))
      .where(eq(orgMembers.orgId, orgId));

    // 2. Fetch Teams
    const orgTeams = await db
      .select({
        id: teams.id,
        name: teams.name,
        slug: teams.slug,
        description: teams.description,
        createdAt: teams.createdAt,
      })
      .from(teams)
      .where(eq(teams.orgId, orgId));

    // 3. Fetch Projects
    const orgProjects = await db
      .select({
        id: projects.id,
        teamId: projects.teamId,
        name: projects.name,
        key: projects.key,
        description: projects.description,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .where(eq(projects.orgId, orgId));

    // 4. Fetch Boards & Columns
    const orgBoards = await db
      .select({
        id: boards.id,
        teamId: boards.teamId,
        projectId: boards.projectId,
        name: boards.name,
        description: boards.description,
        createdAt: boards.createdAt,
      })
      .from(boards)
      .where(eq(boards.orgId, orgId));

    const orgCols = await db
      .select({
        id: columns.id,
        boardId: columns.boardId,
        name: columns.name,
        position: columns.position,
        wipLimit: columns.wipLimit,
        color: columns.color,
      })
      .from(columns);

    // 5. Fetch Tickets
    const orgTickets = await db
      .select({
        id: tickets.id,
        number: tickets.number,
        key: tickets.key,
        title: tickets.title,
        description: tickets.description,
        priority: tickets.priority,
        labels: tickets.labels,
        teamId: tickets.teamId,
        projectId: tickets.projectId,
        boardId: tickets.boardId,
        columnId: tickets.columnId,
        assigneeId: tickets.assigneeId,
        reporterId: tickets.reporterId,
        createdAt: tickets.createdAt,
        updatedAt: tickets.updatedAt,
      })
      .from(tickets)
      .where(eq(tickets.orgId, orgId));

    // 6. Fetch Comments
    const orgComments = await db
      .select({
        id: ticketComments.id,
        ticketId: ticketComments.ticketId,
        authorId: ticketComments.authorId,
        body: ticketComments.body,
        createdAt: ticketComments.createdAt,
      })
      .from(ticketComments)
      .where(eq(ticketComments.orgId, orgId));

    // 7. Configured labels
    const appearance = await getSystemSetting("appearance").catch(() => null);
    const labels = appearance?.labels || [];

    if (format === "csv") {
      const csvLines = [
        "ticket_key,number,title,priority,labels,team_id,project_id,board_id,created_at",
      ];
      for (const t of orgTickets) {
        const safeTitle = `"${t.title.replace(/"/g, '""')}"`;
        const safeLabels = `"${(t.labels || []).join("; ").replace(/"/g, '""')}"`;
        csvLines.push(
          `${t.key},${t.number},${safeTitle},${t.priority},${safeLabels},${t.teamId},${t.projectId},${t.boardId},${t.createdAt.toISOString()}`
        );
      }
      return new NextResponse(csvLines.join("\n"), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${org.slug}-tickets-${Date.now()}.csv"`,
        },
      });
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        description: org.description,
      },
      users: orgUsers,
      teams: orgTeams,
      projects: orgProjects,
      boards: orgBoards,
      columns: orgCols,
      tickets: orgTickets,
      comments: orgComments,
      labels,
    };

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${org.slug}-backup-${Date.now()}.json"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

