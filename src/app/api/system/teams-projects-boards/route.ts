import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import {
  teams,
  projects,
  boards,
  columns,
  teamMembers,
  users,
  tickets,
} from "@/db/schema";
import { handleApiError } from "@/lib/http";
import {
  requireAdminAuth,
  getTeamDependencies,
  getProjectDependencies,
  getBoardDependencies,
} from "@/lib/system";
import { slugify } from "@/lib/slug";
import { AppError, NotFoundError } from "@/lib/errors";
import {
  getSystemSetting,
  setSystemSetting,
  TeamDefaultColumns,
} from "@/lib/settings";

type BoardWithColumns = typeof boards.$inferSelect & {
  columns: Array<typeof columns.$inferSelect>;
};

type ProjectWithBoards = typeof projects.$inferSelect & {
  boards: BoardWithColumns[];
};

export async function GET(req: NextRequest) {
  try {
    const { orgId } = await requireAdminAuth(req);

    const orgTeams = await db
      .select()
      .from(teams)
      .where(eq(teams.orgId, orgId));

    const orgProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.orgId, orgId));

    const orgBoards = await db
      .select()
      .from(boards)
      .where(eq(boards.orgId, orgId));

    const orgColumns = await db
      .select()
      .from(columns)
      .orderBy(columns.position);

    const teamLeads = await db
      .select({
        teamId: teamMembers.teamId,
        userId: teamMembers.userId,
        userName: users.name,
        userEmail: users.email,
      })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(teamMembers.role, "lead"));

    const leadsByTeam = new Map<
      string,
      Array<{ userId: string; name: string; email: string }>
    >();
    for (const l of teamLeads) {
      const list = leadsByTeam.get(l.teamId) || [];
      list.push({ userId: l.userId, name: l.userName, email: l.userEmail });
      leadsByTeam.set(l.teamId, list);
    }

    const columnsByBoard = new Map<string, typeof orgColumns>();
    for (const c of orgColumns) {
      const list = columnsByBoard.get(c.boardId) || [];
      list.push(c);
      columnsByBoard.set(c.boardId, list);
    }

    const boardsByProject = new Map<string, BoardWithColumns[]>();
    for (const b of orgBoards) {
      const list = boardsByProject.get(b.projectId) || [];
      list.push({
        ...b,
        columns: columnsByBoard.get(b.id) || [],
      });
      boardsByProject.set(b.projectId, list);
    }

    const projectsByTeam = new Map<string, ProjectWithBoards[]>();
    for (const p of orgProjects) {
      const list = projectsByTeam.get(p.teamId) || [];
      list.push({
        ...p,
        boards: boardsByProject.get(p.id) || [],
      });
      projectsByTeam.set(p.teamId, list);
    }

    // Default columns configuration per team
    const teamDefaultCols = await getSystemSetting("team_default_columns").catch(
      () => ({}) as TeamDefaultColumns
    );

    const teamsHierarchy = await Promise.all(
      orgTeams.map(async (t) => {
        const deps = await getTeamDependencies(t.id);
        return {
          ...t,
          leads: leadsByTeam.get(t.id) || [],
          dependencies: deps,
          defaultColumns: teamDefaultCols[t.id] || null,
          projects: projectsByTeam.get(t.id) || [],
        };
      })
    );

    return NextResponse.json({
      teams: teamsHierarchy,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { orgId } = await requireAdminAuth(req);
    const body = await req.json();
    const type = body.type as "team" | "project" | "board";

    if (type === "team") {
      const name = String(body.name || "").trim();
      if (!name) throw new AppError("Team name is required", 400);
      const slug = slugify(body.slug || name);
      const [newTeam] = await db
        .insert(teams)
        .values({
          orgId,
          name,
          slug,
          description: String(body.description || ""),
        })
        .returning();

      if (body.leadUserId) {
        await db
          .insert(teamMembers)
          .values({
            teamId: newTeam.id,
            userId: body.leadUserId,
            role: "lead",
          })
          .onConflictDoNothing();
      }

      return NextResponse.json({ item: newTeam }, { status: 201 });
    }

    if (type === "project") {
      const teamId = String(body.teamId || "");
      const name = String(body.name || "").trim();
      const key = String(body.key || "").trim().toUpperCase();
      if (!teamId || !name || !key) {
        throw new AppError("Team ID, name, and key are required", 400);
      }

      const [newProject] = await db
        .insert(projects)
        .values({
          orgId,
          teamId,
          name,
          key,
          description: String(body.description || ""),
        })
        .returning();

      return NextResponse.json({ item: newProject }, { status: 201 });
    }

    if (type === "board") {
      const projectId = String(body.projectId || "");
      const name = String(body.name || "").trim();
      if (!projectId || !name) {
        throw new AppError("Project ID and board name are required", 400);
      }

      const [proj] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      if (!proj) throw new NotFoundError("Project not found");

      const [newBoard] = await db
        .insert(boards)
        .values({
          orgId,
          teamId: proj.teamId,
          projectId,
          name,
          description: String(body.description || ""),
        })
        .returning();

      // Seed default columns
      const teamDefaultCols = await getSystemSetting("team_default_columns").catch(
        () => ({}) as TeamDefaultColumns
      );
      const appSettings = await getSystemSetting("appearance").catch(() => null);
      const defaultCols =
        teamDefaultCols[proj.teamId] || appSettings?.defaultColumns || [
          { name: "Backlog", wipLimit: null, color: "#434B56" },
          { name: "In Progress", wipLimit: 5, color: "#C84317" },
          { name: "Review", wipLimit: 3, color: "#C2410C" },
          { name: "Done", wipLimit: null, color: "#15803D" },
        ];

      for (let i = 0; i < defaultCols.length; i++) {
        const col = defaultCols[i];
        await db.insert(columns).values({
          boardId: newBoard.id,
          name: col.name,
          position: (i + 1) * 1000,
          wipLimit: col.wipLimit,
          color: col.color,
        });
      }

      return NextResponse.json({ item: newBoard }, { status: 201 });
    }

    throw new AppError("Invalid type", 400);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdminAuth(req);
    const body = await req.json();
    const action = String(body.action || "");

    if (action === "update-team") {
      const teamId = String(body.teamId || "");
      const updates: Partial<typeof teams.$inferInsert> = {};
      if (body.name) updates.name = String(body.name).trim();
      if (body.description !== undefined) updates.description = String(body.description);

      if (Object.keys(updates).length > 0) {
        await db.update(teams).set(updates).where(eq(teams.id, teamId));
      }

      if (body.leadUserId) {
        // Demote existing leads in team to member
        await db
          .update(teamMembers)
          .set({ role: "member" })
          .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "lead")));

        // Assign new lead
        const [existingMember] = await db
          .select()
          .from(teamMembers)
          .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, body.leadUserId)))
          .limit(1);

        if (existingMember) {
          await db
            .update(teamMembers)
            .set({ role: "lead" })
            .where(eq(teamMembers.id, existingMember.id));
        } else {
          await db.insert(teamMembers).values({
            teamId,
            userId: body.leadUserId,
            role: "lead",
          });
        }
      }

      return NextResponse.json({ success: true });
    }

    if (action === "move-project") {
      const projectId = String(body.projectId || "");
      const newTeamId = String(body.newTeamId || "");
      if (!projectId || !newTeamId) {
        throw new AppError("Project ID and new Team ID are required", 400);
      }

      // Update project
      await db
        .update(projects)
        .set({ teamId: newTeamId })
        .where(eq(projects.id, projectId));

      // Update boards under this project
      await db
        .update(boards)
        .set({ teamId: newTeamId })
        .where(eq(boards.projectId, projectId));

      // Update tickets under this project
      await db
        .update(tickets)
        .set({ teamId: newTeamId })
        .where(eq(tickets.projectId, projectId));

      return NextResponse.json({ success: true, message: "Project moved to new team" });
    }

    if (action === "set-team-default-columns") {
      const teamId = String(body.teamId || "");
      const columnsList = Array.isArray(body.columns) ? body.columns : [];
      if (!teamId) throw new AppError("Team ID is required", 400);

      const current = await getSystemSetting("team_default_columns").catch(
        () => ({}) as TeamDefaultColumns
      );
      const updated = {
        ...current,
        [teamId]: columnsList,
      };
      await setSystemSetting("team_default_columns", updated);

      return NextResponse.json({ success: true, columns: columnsList });
    }

    if (action === "update-project") {
      const projectId = String(body.projectId || "");
      const updates: Partial<typeof projects.$inferInsert> = {};
      if (body.name) updates.name = String(body.name).trim();
      if (body.description !== undefined) updates.description = String(body.description);

      await db.update(projects).set(updates).where(eq(projects.id, projectId));
      return NextResponse.json({ success: true });
    }

    if (action === "update-board") {
      const boardId = String(body.boardId || "");
      const updates: Partial<typeof boards.$inferInsert> = {};
      if (body.name) updates.name = String(body.name).trim();
      if (body.description !== undefined) updates.description = String(body.description);

      await db.update(boards).set(updates).where(eq(boards.id, boardId));
      return NextResponse.json({ success: true });
    }

    throw new AppError("Invalid action", 400);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { orgId } = await requireAdminAuth(req);
    const searchParams = req.nextUrl.searchParams;
    const type = searchParams.get("type");
    const id = searchParams.get("id");

    if (!type || !id) {
      throw new AppError("Type and ID are required", 400);
    }

    if (type === "team") {
      const deps = await getTeamDependencies(id);
      await db.delete(teams).where(and(eq(teams.id, id), eq(teams.orgId, orgId)));
      return NextResponse.json({ success: true, deleted: "team", id, affected: deps });
    }

    if (type === "project") {
      const deps = await getProjectDependencies(id);
      await db.delete(projects).where(and(eq(projects.id, id), eq(projects.orgId, orgId)));
      return NextResponse.json({ success: true, deleted: "project", id, affected: deps });
    }

    if (type === "board") {
      const deps = await getBoardDependencies(id);
      await db.delete(boards).where(and(eq(boards.id, id), eq(boards.orgId, orgId)));
      return NextResponse.json({ success: true, deleted: "board", id, affected: deps });
    }

    throw new AppError("Invalid delete type", 400);
  } catch (err) {
    return handleApiError(err);
  }
}
