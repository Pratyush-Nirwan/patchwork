import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import {
  orgMembers,
  teamMembers,
  teams,
  projects,
  boards,
  tickets,
  type EffectiveRole,
  type OrgRole,
  type TeamRole,
  type MemberSubRole,
} from "@/db/schema";
import { ForbiddenError, NotFoundError } from "./errors";

const ROLE_WEIGHT: Record<EffectiveRole, number> = {
  viewer: 1,
  member: 2,
  lead: 3,
  admin: 4,
};

export interface PermissionDefinition {
  id: string;
  category: "Organization & System" | "Teams & Projects" | "Boards & Columns" | "Tickets & Work";
  action: string;
  description: string;
  allowedRoles: EffectiveRole[];
}

export const PERMISSIONS_MATRIX: PermissionDefinition[] = [
  {
    id: "org.manage",
    category: "Organization & System",
    action: "Manage Organization",
    description: "Edit organization name, slug, description, and workspace metadata",
    allowedRoles: ["admin"],
  },
  {
    id: "system.configure",
    category: "Organization & System",
    action: "System Configuration",
    description: "Manage users, security policies, storage settings, integrations, and diagnostics",
    allowedRoles: ["admin"],
  },
  {
    id: "team.create",
    category: "Teams & Projects",
    action: "Create Teams",
    description: "Create new teams inside the organization",
    allowedRoles: ["admin"],
  },
  {
    id: "team.manage",
    category: "Teams & Projects",
    action: "Manage Team & Members",
    description: "Update team name/description, assign team leads, and add/remove team members",
    allowedRoles: ["admin", "lead"],
  },
  {
    id: "project.manage",
    category: "Teams & Projects",
    action: "Manage Projects & Boards",
    description: "Create, rename, or delete projects and boards within accessible teams",
    allowedRoles: ["admin", "lead"],
  },
  {
    id: "board.reorder_columns",
    category: "Boards & Columns",
    action: "Reorder Kanban Columns",
    description: "Drag and reorder kanban columns on live boards",
    allowedRoles: ["admin", "lead"],
  },
  {
    id: "board.manage_columns",
    category: "Boards & Columns",
    action: "Create / Edit Columns",
    description: "Create columns, set WIP limits, edit column colors",
    allowedRoles: ["admin", "lead"],
  },
  {
    id: "ticket.create",
    category: "Tickets & Work",
    action: "Create Tickets",
    description: "Create new tickets in assigned project boards",
    allowedRoles: ["admin", "lead", "member"],
  },
  {
    id: "ticket.edit",
    category: "Tickets & Work",
    action: "Edit Tickets",
    description: "Update ticket title, description, priority, labels, and assignment",
    allowedRoles: ["admin", "lead", "member"],
  },
  {
    id: "ticket.move",
    category: "Tickets & Work",
    action: "Move & Transition Tickets",
    description: "Drag tickets between columns and change workflow status",
    allowedRoles: ["admin", "lead", "member"],
  },
  {
    id: "ticket.comment",
    category: "Tickets & Work",
    action: "Comment & Collaborate",
    description: "Post comments and participate in ticket discussions",
    allowedRoles: ["admin", "lead", "member"],
  },
  {
    id: "attachment.upload",
    category: "Tickets & Work",
    action: "Upload Attachments",
    description: "Attach files, images, logs, and documents to tickets",
    allowedRoles: ["admin", "lead", "member"],
  },
  {
    id: "link.manage",
    category: "Tickets & Work",
    action: "Manage Forge Links",
    description: "Link pull requests, issues, and commits from GitHub / GitLab",
    allowedRoles: ["admin", "lead", "member"],
  },
  {
    id: "workspace.view",
    category: "Boards & Columns",
    action: "View Boards & Tickets",
    description: "Read-only access to browse teams, boards, tickets, and attachments",
    allowedRoles: ["admin", "lead", "member", "viewer"],
  },
];

export async function getOrgRole(userId: string, orgId: string): Promise<OrgRole | null> {
  const [membership] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  return membership ? membership.role : null;
}

export async function getEffectiveTeamRole(
  userId: string,
  teamId: string
): Promise<{ role: EffectiveRole; subRole: MemberSubRole | null; orgId: string }> {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) {
    throw new NotFoundError("Team not found");
  }

  const orgRole = await getOrgRole(userId, team.orgId);
  if (orgRole === "admin") {
    return { role: "admin", subRole: null, orgId: team.orgId };
  }

  const [teamMember] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);

  if (!teamMember) {
    throw new ForbiddenError("You do not have access to this team");
  }

  return { role: teamMember.role, subRole: teamMember.subRole || "developer", orgId: team.orgId };
}

export async function requireOrgAdmin(userId: string, orgId: string): Promise<void> {
  const role = await getOrgRole(userId, orgId);
  if (role !== "admin") {
    throw new ForbiddenError("Organization admin role required");
  }
}

export async function requireOrgMember(userId: string, orgId: string): Promise<OrgRole> {
  const role = await getOrgRole(userId, orgId);
  if (!role) {
    throw new ForbiddenError("Organization membership required");
  }
  return role;
}

export async function requireTeamRole(
  userId: string,
  teamId: string,
  minRole: EffectiveRole
): Promise<{ role: EffectiveRole; subRole: MemberSubRole | null; orgId: string }> {
  const { role, subRole, orgId } = await getEffectiveTeamRole(userId, teamId);
  if (ROLE_WEIGHT[role] < ROLE_WEIGHT[minRole]) {
    throw new ForbiddenError(
      `Requires at least '${minRole}' role (current role: '${role}')`
    );
  }
  return { role, subRole, orgId };
}

export async function requireProjectRole(
  userId: string,
  projectId: string,
  minRole: EffectiveRole
) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) {
    throw new NotFoundError("Project not found");
  }
  const { role, subRole } = await requireTeamRole(userId, project.teamId, minRole);
  return { project, role, subRole };
}

export async function requireBoardRole(
  userId: string,
  boardId: string,
  minRole: EffectiveRole
) {
  const [board] = await db.select().from(boards).where(eq(boards.id, boardId)).limit(1);
  if (!board) {
    throw new NotFoundError("Board not found");
  }
  const { role, subRole } = await requireTeamRole(userId, board.teamId, minRole);
  return { board, role, subRole };
}

export async function requireTicketRole(
  userId: string,
  ticketId: string,
  minRole: EffectiveRole
) {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) {
    throw new NotFoundError("Ticket not found");
  }
  const { role, subRole } = await requireTeamRole(userId, ticket.teamId, minRole);
  return { ticket, role, subRole };
}

export async function getAccessibleTeamIds(userId: string, orgId?: string): Promise<string[]> {
  const orgRows = await db
    .select()
    .from(orgMembers)
    .where(eq(orgMembers.userId, userId));

  const adminOrgIds = new Set(
    orgRows
      .filter((r) => r.role === "admin" && (!orgId || r.orgId === orgId))
      .map((r) => r.orgId)
  );

  const allTeams = await db.select().from(teams);
  const directMemberships = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  const directTeamIds = new Set(directMemberships.map((m) => m.teamId));

  return allTeams
    .filter((t) => (!orgId || t.orgId === orgId) && (adminOrgIds.has(t.orgId) || directTeamIds.has(t.id)))
    .map((t) => t.id);
}

export type { OrgRole, TeamRole, EffectiveRole };

