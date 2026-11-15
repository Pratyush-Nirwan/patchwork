import { eq,and,asc,inArray,isNull } from "drizzle-orm";
import { db } from "@/db";
import {
orgs,teams,projects,
boards,
columns,
tickets,
ticketComments,
ticketAttachments,
ticketLinks
} from "@/db/schema";
import {
requireTeamRole,
requireProjectRole,
requireBoardRole,getEffectiveTeamRole
} from "../rbac";
import { AppError } from "../errors";
import { listUserOrgs } from "./orgs";
import { listOrgTeams,listTeamMembers } from "./teams";

export async function createProject(
  actorId: string,
  teamId: string,
  input: { name: string; key?: string; description?: string }
) {
  const { orgId } = await requireTeamRole(actorId, teamId, "lead");
  const name = input.name.trim();
  if (!name) throw new AppError("Project name is required", 400);

  const rawKey = (
    input.key ||
    name
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 5)
      .toUpperCase() ||
    "PRJ"
  )
    .trim()
    .toUpperCase();

  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(rawKey)) {
    throw new AppError(
      "Project key must be 2-10 uppercase alphanumeric characters starting with a letter",
      400
    );
  }

  const [existing] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.teamId, teamId), eq(projects.key, rawKey)))
    .limit(1);
  if (existing) {
    throw new AppError("Project key already exists in this team", 409);
  }

  const [project] = await db
    .insert(projects)
    .values({
      orgId,
      teamId,
      name,
      key: rawKey,
      description: input.description?.trim() || "",
    })
    .returning();

  return project;
}

export async function listTeamProjects(actorId: string, teamId: string) {
  await requireTeamRole(actorId, teamId, "viewer");
  return db
    .select()
    .from(projects)
    .where(eq(projects.teamId, teamId))
    .orderBy(asc(projects.createdAt));
}

export async function updateProject(
  actorId: string,
  projectId: string,
  input: { name?: string; description?: string }
) {
  await requireProjectRole(actorId, projectId, "lead");
  const updates: Partial<typeof projects.$inferInsert> = {};
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new AppError("Project name cannot be empty", 400);
    updates.name = trimmed;
  }
  if (input.description !== undefined) {
    updates.description = input.description.trim();
  }
  const [updated] = await db
    .update(projects)
    .set(updates)
    .where(eq(projects.id, projectId))
    .returning();
  return updated;
}

export async function deleteProject(actorId: string, projectId: string) {
  await requireProjectRole(actorId, projectId, "lead");
  await db.delete(projects).where(eq(projects.id, projectId));
}

const DEFAULT_COLUMNS = [
  { name: "Backlog", color: "#64748B", wipLimit: 6 },
  { name: "Todo", color: "#3B82F6", wipLimit: 4 },
  { name: "In Progress", color: "#F59E0B", wipLimit: 3 },
  { name: "In Review", color: "#8B5CF6", wipLimit: 2 },
  { name: "Done", color: "#10B981", wipLimit: null },
];

export async function createBoard(
  actorId: string,
  projectId: string,
  input: {
    name: string;
    description?: string;
    columns?: Array<{ name: string; color?: string; wipLimit?: number | null }>;
  }
) {
  const { project } = await requireProjectRole(actorId, projectId, "lead");
  const name = input.name.trim();
  if (!name) throw new AppError("Board name is required", 400);

  const [board] = await db
    .insert(boards)
    .values({
      orgId: project.orgId,
      teamId: project.teamId,
      projectId: project.id,
      name,
      description: input.description?.trim() || "",
    })
    .returning();

  const colsToCreate = input.columns && input.columns.length > 0 ? input.columns : DEFAULT_COLUMNS;
  const createdColumns = [];
  for (let i = 0; i < colsToCreate.length; i++) {
    const c = colsToCreate[i];
    const [col] = await db
      .insert(columns)
      .values({
        boardId: board.id,
        name: c.name.trim(),
        position: i,
        wipLimit: c.wipLimit ?? null,
        color: c.color || "#64748B",
      })
      .returning();
    createdColumns.push(col);
  }

  return { ...board, columns: createdColumns };
}

export async function listProjectBoards(actorId: string, projectId: string) {
  await requireProjectRole(actorId, projectId, "viewer");
  return db
    .select()
    .from(boards)
    .where(eq(boards.projectId, projectId))
    .orderBy(asc(boards.createdAt));
}

export async function getBoardWithDetails(actorId: string, boardId: string) {
  const { board, role, subRole } = await requireBoardRole(actorId, boardId, "viewer");
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, board.projectId))
    .limit(1);
  const [team] = await db.select().from(teams).where(eq(teams.id, board.teamId)).limit(1);
  const [org] = await db.select().from(orgs).where(eq(orgs.id, board.orgId)).limit(1);

  const boardColumns = await db
    .select()
    .from(columns)
    .where(eq(columns.boardId, board.id))
    .orderBy(asc(columns.position), asc(columns.createdAt));

  const boardTickets = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.boardId, board.id), isNull(tickets.archivedAt)))
    .orderBy(asc(tickets.position), asc(tickets.createdAt));

  const ticketIds = boardTickets.map((t) => t.id);
  const commentCounts = new Map<string, number>();
  const attachmentCounts = new Map<string, number>();
  const linkCounts = new Map<string, number>();

  if (ticketIds.length > 0) {
    const cRows = await db
      .select({ ticketId: ticketComments.ticketId })
      .from(ticketComments)
      .where(inArray(ticketComments.ticketId, ticketIds));
    for (const r of cRows) {
      commentCounts.set(r.ticketId, (commentCounts.get(r.ticketId) || 0) + 1);
    }

    const aRows = await db
      .select({ ticketId: ticketAttachments.ticketId })
      .from(ticketAttachments)
      .where(inArray(ticketAttachments.ticketId, ticketIds));
    for (const r of aRows) {
      attachmentCounts.set(r.ticketId, (attachmentCounts.get(r.ticketId) || 0) + 1);
    }

    const lRows = await db
      .select({ ticketId: ticketLinks.ticketId })
      .from(ticketLinks)
      .where(inArray(ticketLinks.ticketId, ticketIds));
    for (const r of lRows) {
      linkCounts.set(r.ticketId, (linkCounts.get(r.ticketId) || 0) + 1);
    }
  }

  const enrichedTickets = boardTickets.map((t) => ({
    ...t,
    commentCount: commentCounts.get(t.id) || 0,
    attachmentCount: attachmentCounts.get(t.id) || 0,
    linkCount: linkCounts.get(t.id) || 0,
  }));

  const members = await listTeamMembers(actorId, board.teamId);

  return {
    board,
    project,
    team,
    org,
    role,
    subRole: subRole || (role === "admin" ? null : role === "lead" ? null : "developer"),
    columns: boardColumns,
    tickets: enrichedTickets,
    members,
  };
}

export async function updateBoard(
  actorId: string,
  boardId: string,
  input: { name?: string; description?: string }
) {
  await requireBoardRole(actorId, boardId, "lead");
  const updates: Partial<typeof boards.$inferInsert> = {};
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new AppError("Board name cannot be empty", 400);
    updates.name = trimmed;
  }
  if (input.description !== undefined) {
    updates.description = input.description.trim();
  }
  const [updated] = await db
    .update(boards)
    .set(updates)
    .where(eq(boards.id, boardId))
    .returning();
  return updated;
}

export async function deleteBoard(actorId: string, boardId: string) {
  await requireBoardRole(actorId, boardId, "lead");
  await db.delete(boards).where(eq(boards.id, boardId));
}


export async function getFullWorkspaceTree(userId: string) {
  const userOrgs = await listUserOrgs(userId);
  const result = [];

  for (const org of userOrgs) {
    const orgTeams = await listOrgTeams(userId, org.id);
    const teamsWithProjects = [];
    for (const team of orgTeams) {
      const { role, subRole } = await getEffectiveTeamRole(userId, team.id);
      const teamProjects = await db
        .select()
        .from(projects)
        .where(eq(projects.teamId, team.id))
        .orderBy(asc(projects.createdAt));

      const projectsWithBoards = [];
      for (const proj of teamProjects) {
        const projBoards = await db
          .select()
          .from(boards)
          .where(eq(boards.projectId, proj.id))
          .orderBy(asc(boards.createdAt));
        projectsWithBoards.push({
          ...proj,
          boards: projBoards,
        });
      }

      teamsWithProjects.push({
        ...team,
        effectiveRole: role,
        effectiveSubRole: subRole,
        projects: projectsWithBoards,
      });
    }

    result.push({
      ...org,
      teams: teamsWithProjects,
    });
  }

  return result;
}
