import { eq,and,asc,inArray } from "drizzle-orm";
import { db } from "@/db";
import {
orgMembers,
teams,
teamMembers,users,type TeamRole,
type MemberSubRole
} from "@/db/schema";
import {
requireOrgAdmin,
requireOrgMember,
requireTeamRole,getAccessibleTeamIds
} from "../rbac";
import { AppError,ForbiddenError,NotFoundError } from "../errors";
import { slugify } from "../slug";

import { resolveOrCreateUser } from "./orgs";

export async function createTeam(
  actorId: string,
  orgId: string,
  input: { name: string; slug?: string; description?: string }
) {
  await requireOrgAdmin(actorId, orgId);
  const name = input.name.trim();
  if (!name) throw new AppError("Team name is required", 400);
  const slug = slugify(input.slug || name);
  if (!slug) throw new AppError("Valid team slug is required", 400);

  const [existing] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.orgId, orgId), eq(teams.slug, slug)))
    .limit(1);
  if (existing) {
    throw new AppError("Team slug already exists in this organization", 409);
  }

  const [team] = await db
    .insert(teams)
    .values({
      orgId,
      name,
      slug,
      description: input.description?.trim() || "",
    })
    .returning();

  await db.insert(teamMembers).values({
    teamId: team.id,
    userId: actorId,
    role: "lead",
  });

  return team;
}

export async function listOrgTeams(actorId: string, orgId: string) {
  await requireOrgMember(actorId, orgId);
  const accessibleTeamIds = await getAccessibleTeamIds(actorId, orgId);
  if (accessibleTeamIds.length === 0) return [];
  return db
    .select()
    .from(teams)
    .where(and(eq(teams.orgId, orgId), inArray(teams.id, accessibleTeamIds)))
    .orderBy(asc(teams.createdAt));
}

export async function updateTeam(
  actorId: string,
  teamId: string,
  input: { name?: string; description?: string }
) {
  await requireTeamRole(actorId, teamId, "lead");
  const updates: Partial<typeof teams.$inferInsert> = {};
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new AppError("Team name cannot be empty", 400);
    updates.name = trimmed;
  }
  if (input.description !== undefined) {
    updates.description = input.description.trim();
  }
  const [updated] = await db
    .update(teams)
    .set(updates)
    .where(eq(teams.id, teamId))
    .returning();
  return updated;
}

export async function deleteTeam(actorId: string, teamId: string) {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) throw new NotFoundError("Team not found");
  await requireOrgAdmin(actorId, team.orgId);
  await db.delete(teams).where(eq(teams.id, teamId));
}

export async function addTeamMember(
  actorId: string,
  teamId: string,
  input: {
    userId?: string;
    email?: string;
    name?: string;
    password?: string;
    role: TeamRole | "admin";
    subRole?: MemberSubRole | null;
  }
) {
  const { orgId, role: actorEffectiveRole } = await requireTeamRole(
    actorId,
    teamId,
    "lead"
  );
  if (!["admin", "lead", "member", "viewer"].includes(input.role)) {
    throw new AppError("Invalid team role", 400);
  }

  if (input.role === "admin" && actorEffectiveRole !== "admin") {
    throw new ForbiddenError(
      "Only organization admins can create or assign admin accounts"
    );
  }

  const targetUserId = await resolveOrCreateUser(input);

  const [orgMember] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)))
    .limit(1);

  if (input.role === "admin") {
    if (!orgMember) {
      await db.insert(orgMembers).values({
        orgId,
        userId: targetUserId,
        role: "admin",
      });
    } else if (orgMember.role !== "admin") {
      await db
        .update(orgMembers)
        .set({ role: "admin" })
        .where(eq(orgMembers.id, orgMember.id));
    }

    const [existingTeamMember] = await db
      .select()
      .from(teamMembers)
      .where(
        and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId))
      )
      .limit(1);

    if (!existingTeamMember) {
      const [created] = await db
        .insert(teamMembers)
        .values({
          teamId,
          userId: targetUserId,
          role: "lead",
        })
        .returning();
      return { ...created, role: "admin" as const };
    }
    return { ...existingTeamMember, role: "admin" as const };
  }

  if (!orgMember) {
    await db.insert(orgMembers).values({
      orgId,
      userId: targetUserId,
      role: "member",
    });
  } else if (orgMember.role === "admin") {
    if (actorEffectiveRole !== "admin") {
      throw new ForbiddenError(
        "Team leads cannot modify organization admin accounts"
      );
    }
    if (targetUserId !== actorId) {
      await db
        .update(orgMembers)
        .set({ role: "member" })
        .where(eq(orgMembers.id, orgMember.id));
    }
  }

  const [existing] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(teamMembers)
      .set({
        role: input.role,
        subRole: input.role === "member" ? (input.subRole || existing.subRole || "developer") : null,
      })
      .where(eq(teamMembers.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(teamMembers)
    .values({
      teamId,
      userId: targetUserId,
      role: input.role,
      subRole: input.role === "member" ? (input.subRole || "developer") : null,
    })
    .returning();
  return created;
}

export async function listTeamMembers(actorId: string, teamId: string) {
  const { orgId } = await requireTeamRole(actorId, teamId, "viewer");
  const direct = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: teamMembers.role,
      subRole: teamMembers.subRole,
    })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, teamId));

  const admins = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, "admin")));

  const byId = new Map<string, { id: string; name: string; email: string; role: string }>();
  for (const m of direct) {
    byId.set(m.id, m);
  }
  for (const a of admins) {
    byId.set(a.id, { ...a, role: "admin" });
  }
  return Array.from(byId.values());
}
