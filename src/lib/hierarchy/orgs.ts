import { eq,and,asc,inArray,sql } from "drizzle-orm";
import { db } from "@/db";
import {
orgs,
orgMembers,users,
type OrgRole
} from "@/db/schema";
import {
requireOrgAdmin,
requireOrgMember
} from "../rbac";
import { hashPassword } from "../auth";
import { AppError,ForbiddenError,NotFoundError } from "../errors";
import { normalizeEmail,isValidEmailFormat,EmailTakenError } from "../email";
import { slugify } from "../slug";

export async function resolveOrCreateUser(input: {
  userId?: string;
  email?: string;
  name?: string;
  password?: string;
  mustChangePassword?: boolean;
}): Promise<string> {
  if (input.userId) {
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!u) throw new NotFoundError("User not found");
    return u.id;
  }

  if (input.email) {
    const email = normalizeEmail(input.email);
    if (!email || !isValidEmailFormat(email)) {
      throw new AppError("Valid email is required", 400, "INVALID_EMAIL");
    }
    const [existing] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);

    if (input.password !== undefined && input.password !== "") {
      if (existing) {
        throw new EmailTakenError(`This email is already used by ${existing.name}.`, existing.name);
      }
      const name = (input.name || email.split("@")[0]).trim();
      if (!name) {
        throw new AppError("Name is required", 400, "INVALID_NAME");
      }
      if (input.password.length < 8) {
        throw new AppError(
          "Password must be at least 8 characters",
          400,
          "WEAK_PASSWORD"
        );
      }
      const passwordHash = await hashPassword(input.password);
      const [created] = await db
        .insert(users)
        .values({
          email,
          name,
          passwordHash,
          mustChangePassword: input.mustChangePassword ?? true,
        })
        .returning();
      return created.id;
    }

    if (existing) {
      return existing.id;
    }

    throw new NotFoundError(
      "User with that email not found. Provide name and password to create a new account."
    );
  }

  throw new AppError("userId or email is required", 400);
}

export async function createOrg(
  userId: string,
  input: { name: string; slug?: string }
) {
  const name = input.name.trim();
  if (!name) throw new AppError("Organization name is required", 400);
  const slug = slugify(input.slug || name);
  if (!slug) throw new AppError("Valid organization slug is required", 400);

  const [existing] = await db.select().from(orgs).where(eq(orgs.slug, slug)).limit(1);
  if (existing) {
    throw new AppError("Organization slug already in use", 409, "SLUG_EXISTS");
  }

  const [org] = await db
    .insert(orgs)
    .values({ name, slug, createdById: userId })
    .returning();

  await db.insert(orgMembers).values({
    orgId: org.id,
    userId,
    role: "admin",
  });

  return org;
}

export async function listUserOrgs(userId: string) {
  const memberships = await db
    .select({
      org: orgs,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .innerJoin(orgs, eq(orgMembers.orgId, orgs.id))
    .where(eq(orgMembers.userId, userId))
    .orderBy(asc(orgs.createdAt));

  return memberships.map((m) => ({
    ...m.org,
    orgRole: m.role,
  }));
}

export async function updateOrg(
  actorId: string,
  orgId: string,
  input: { name: string }
) {
  await requireOrgAdmin(actorId, orgId);
  const name = input.name.trim();
  if (!name) throw new AppError("Organization name is required", 400);
  const [updated] = await db
    .update(orgs)
    .set({ name })
    .where(eq(orgs.id, orgId))
    .returning();
  if (!updated) throw new NotFoundError("Organization not found");
  return updated;
}

export async function deleteOrg(actorId: string, orgId: string) {
  await requireOrgAdmin(actorId, orgId);
  await db.delete(orgs).where(eq(orgs.id, orgId));
}

export async function addOrgMember(
  actorId: string,
  orgId: string,
  input: {
    email?: string;
    userId?: string;
    name?: string;
    password?: string;
    role: OrgRole;
  }
) {
  await requireOrgAdmin(actorId, orgId);
  if (!["admin", "member"].includes(input.role)) {
    throw new AppError("Invalid organization role", 400);
  }
  const targetUserId = await resolveOrCreateUser(input);

  const [existing] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(orgMembers)
      .set({ role: input.role })
      .where(eq(orgMembers.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(orgMembers)
    .values({ orgId, userId: targetUserId, role: input.role })
    .returning();
  return created;
}

export async function listOrgMembers(actorId: string, orgId: string) {
  await requireOrgMember(actorId, orgId);
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(eq(orgMembers.orgId, orgId))
    .orderBy(asc(orgMembers.createdAt));
}


export async function updateUser(
  actorId: string,
  targetUserId: string,
  input: { name?: string; email?: string }
) {
  const [targetUser] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!targetUser) throw new NotFoundError("User not found");

  const isSelf = actorId === targetUserId;
  if (!isSelf) {
    const [actorUser] = await db.select().from(users).where(eq(users.id, actorId)).limit(1);
    if (!actorUser?.isSetupAdmin) {
      const adminOrgs = await db
        .select({ orgId: orgMembers.orgId })
        .from(orgMembers)
        .where(and(eq(orgMembers.userId, actorId), eq(orgMembers.role, "admin")));
      const adminOrgIds = adminOrgs.map((o) => o.orgId);
      if (adminOrgIds.length === 0) {
        throw new ForbiddenError("Insufficient permissions to edit user");
      }
      const [commonMember] = await db
        .select()
        .from(orgMembers)
        .where(and(eq(orgMembers.userId, targetUserId), inArray(orgMembers.orgId, adminOrgIds)))
        .limit(1);
      if (!commonMember) {
        throw new ForbiddenError("Insufficient permissions to edit user");
      }
    }
  }

  const updates: Partial<typeof users.$inferInsert> = {};
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new AppError("Name is required", 400, "INVALID_NAME");
    updates.name = trimmed;
  }

  if (input.email !== undefined) {
    const normalized = normalizeEmail(input.email);
    if (!normalized || !isValidEmailFormat(normalized)) {
      throw new AppError("Valid email is required", 400, "INVALID_EMAIL");
    }

    const [existing] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${normalized})`)
      .limit(1);

    if (existing && existing.id !== targetUserId) {
      throw new EmailTakenError(`This email is already used by ${existing.name}.`, existing.name);
    }
    updates.email = normalized;
  }

  if (Object.keys(updates).length === 0) {
    return targetUser;
  }

  const [updated] = await db.update(users).set(updates).where(eq(users.id, targetUserId)).returning();
  return updated;
}
