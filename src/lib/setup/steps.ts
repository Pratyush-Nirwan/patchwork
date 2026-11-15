import { eq,and,asc,sql,ne } from "drizzle-orm";
import { db } from "@/db";
import {
users,
orgs,
orgMembers,
teams,
teamMembers,
projects,
boards,
columns,
setupState,
setupCredentials,
type SetupDraftData,
type SetupDraftTeam,
type SetupDraftEmployee,
type SetupDraftProject,
type SetupDraftBoard,type TeamRole
} from "@/db/schema";
import { hashPassword,registerUser,type AuthContext } from "../auth";
import { ForbiddenError } from "../errors";
import { normalizeEmail,isValidEmailFormat,EmailTakenError } from "../email";
import { slugify } from "../slug";
import {
verifySubmittedSetupToken,
consumeSetupToken,
checkSetupTokenRateLimit,
recordFailedSetupTokenAttempt,
encryptSetupToken,
} from "../setup-token";

import {
ValidationError,
DEFAULT_SETUP_COLUMNS,
assertSetupAdminAccess,generateSystemPassword,
getOrCreateSetupState
} from "./state";
import { normalizeRoleInput } from "./csv";

export async function runSetupStep1Admin(
  actorId: string | null | undefined,
  input: {
    name: string;
    email: string;
    password?: string;
    setupToken?: string;
    clientIp?: string;
  }
): Promise<{ auth?: AuthContext; state: typeof setupState.$inferSelect }> {
  const state = await getOrCreateSetupState();
  if (state.isCompleted) {
    throw new ForbiddenError("Setup is already completed and locked");
  }

  const clientIp = input.clientIp || "127.0.0.1";
  const name = (input.name || "").trim();
  const email = normalizeEmail(input.email);
  const password = input.password || "";

  const [existingFirstUser] = await db
    .select()
    .from(users)
    .orderBy(asc(users.createdAt))
    .limit(1);

  if (!existingFirstUser) {
    await verifySubmittedSetupToken(input.setupToken, clientIp);
  } else if (!actorId || actorId !== existingFirstUser.id) {
    checkSetupTokenRateLimit(clientIp);
    recordFailedSetupTokenAttempt(clientIp);
    throw new ForbiddenError(
      "Registration is closed until initial workspace setup is completed"
    );
  }

  const fields: Record<string, string> = {};
  if (!name) fields.name = "Full name is required";
  if (!email || !isValidEmailFormat(email)) fields.email = "Valid work email is required";
  if (!existingFirstUser && password.length < 8) {
    fields.password = "Password must be at least 8 characters";
  } else if (existingFirstUser && password && password.length < 8) {
    fields.password = "Password must be at least 8 characters";
  }

  if (Object.keys(fields).length > 0) {
    throw new ValidationError(Object.values(fields)[0], fields);
  }

  if (existingFirstUser && email !== normalizeEmail(existingFirstUser.email)) {
    const [collision] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(sql`lower(${users.email}) = lower(${email})`, ne(users.id, existingFirstUser.id)))
      .limit(1);
    if (collision) {
      throw new EmailTakenError(`This email is already used by ${collision.name}.`, collision.name);
    }
  }

  if (!existingFirstUser) {
    const auth = await registerUser({
      name,
      email,
      password,
    });
    await consumeSetupToken();
    const refreshed = await getOrCreateSetupState();
    return { auth, state: refreshed };
  }

  const updates: Partial<typeof users.$inferInsert> = { name, email };
  if (password) {
    updates.passwordHash = await hashPassword(password);
  }
  await db.update(users).set(updates).where(eq(users.id, existingFirstUser.id));

  const nextCompleted = Array.from(new Set([...state.completedSteps, 1]));
  const nextDraft: SetupDraftData = {
    ...state.draftData,
    admin: { name, email },
  };
  const [updatedState] = await db
    .update(setupState)
    .set({
      adminUserId: existingFirstUser.id,
      currentStep: 2,
      completedSteps: nextCompleted,
      draftData: nextDraft,
      updatedAt: new Date(),
    })
    .where(eq(setupState.id, "default"))
    .returning();

  return { state: updatedState };
}

export async function runSetupStep2Org(
  actorId: string,
  input: { name: string; slug?: string; description?: string }
) {
  const state = await assertSetupAdminAccess(actorId);
  const name = (input.name || "").trim();
  const slug = slugify(input.slug || name);
  const description = (input.description || "").trim();

  const fields: Record<string, string> = {};
  if (!name) fields.name = "Organization name is required";
  if (!slug) fields.slug = "Valid URL slug is required";
  if (Object.keys(fields).length > 0) {
    throw new ValidationError(Object.values(fields)[0], fields);
  }

  let orgRow: typeof orgs.$inferSelect | undefined;

  if (state.orgId) {
    const [existing] = await db
      .select()
      .from(orgs)
      .where(eq(orgs.id, state.orgId))
      .limit(1);
    if (existing) {
      const [updated] = await db
        .update(orgs)
        .set({ name, slug, description })
        .where(eq(orgs.id, existing.id))
        .returning();
      orgRow = updated;
    }
  }

  if (!orgRow) {
    const [bySlug] = await db
      .select()
      .from(orgs)
      .where(eq(orgs.slug, slug))
      .limit(1);
    if (bySlug) {
      const [updated] = await db
        .update(orgs)
        .set({ name, slug, description })
        .where(eq(orgs.id, bySlug.id))
        .returning();
      orgRow = updated;
    } else {
      const [created] = await db
        .insert(orgs)
        .values({
          name,
          slug,
          description,
          createdById: actorId,
        })
        .returning();
      orgRow = created;
    }
  }

  const [existingMembership] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgRow.id), eq(orgMembers.userId, actorId)))
    .limit(1);

  if (!existingMembership) {
    await db.insert(orgMembers).values({
      orgId: orgRow.id,
      userId: actorId,
      role: "admin",
    });
  } else if (existingMembership.role !== "admin") {
    await db
      .update(orgMembers)
      .set({ role: "admin" })
      .where(eq(orgMembers.id, existingMembership.id));
  }

  const nextCompleted = Array.from(new Set([...state.completedSteps, 2]));
  const nextDraft: SetupDraftData = {
    ...state.draftData,
    org: { name: orgRow.name, slug: orgRow.slug, description: orgRow.description },
  };

  const [updatedState] = await db
    .update(setupState)
    .set({
      orgId: orgRow.id,
      currentStep: 3,
      completedSteps: nextCompleted,
      draftData: nextDraft,
      updatedAt: new Date(),
    })
    .where(eq(setupState.id, "default"))
    .returning();

  return { org: orgRow, state: updatedState };
}

export async function runSetupStep3Teams(
  actorId: string,
  input: { teams: SetupDraftTeam[] }
) {
  const state = await assertSetupAdminAccess(actorId);
  if (!state.orgId) {
    throw new ValidationError("Complete Step 2 (Organization) before creating teams", {
      org: "Organization is required first",
    });
  }

  const items = Array.isArray(input.teams) ? input.teams : [];
  if (items.length === 0) {
    throw new ValidationError("At least one team is required", {
      teams: "Add at least one engineering team",
    });
  }

  const seenSlugs = new Set<string>();
  const normalizedTeams: Array<{
    id?: string;
    name: string;
    slug: string;
    description: string;
    leadEmail: string;
  }> = [];

  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    const name = (raw.name || "").trim();
    const slug = slugify(raw.slug || name);
    const description = (raw.description || "").trim();
    const leadEmail = (raw.leadEmail || "").trim().toLowerCase();

    if (!name) {
      throw new ValidationError(`Team #${i + 1}: Name is required`, {
        [`teams.${i}.name`]: "Team name is required",
      });
    }
    if (!slug) {
      throw new ValidationError(`Team #${i + 1}: Valid slug is required`, {
        [`teams.${i}.slug`]: "Valid team slug is required",
      });
    }
    if (seenSlugs.has(slug)) {
      throw new ValidationError(`Duplicate team slug '${slug}'`, {
        [`teams.${i}.slug`]: `Duplicate team slug '${slug}'`,
      });
    }
    seenSlugs.add(slug);
    normalizedTeams.push({ id: raw.id, name, slug, description, leadEmail });
  }

  const existingTeams = await db
    .select()
    .from(teams)
    .where(eq(teams.orgId, state.orgId))
    .orderBy(asc(teams.createdAt));

  const savedTeams: Array<typeof teams.$inferSelect & { leadEmail: string }> = [];

  for (const t of normalizedTeams) {
    const match =
      (t.id ? existingTeams.find((et) => et.id === t.id) : undefined) ||
      existingTeams.find((et) => et.slug === t.slug);

    let teamRow: typeof teams.$inferSelect;
    if (match) {
      const [updated] = await db
        .update(teams)
        .set({
          name: t.name,
          slug: t.slug,
          description: t.description,
        })
        .where(eq(teams.id, match.id))
        .returning();
      teamRow = updated;
    } else {
      const [created] = await db
        .insert(teams)
        .values({
          orgId: state.orgId,
          name: t.name,
          slug: t.slug,
          description: t.description,
        })
        .returning();
      teamRow = created;
    }

    // Ensure admin is linked to the team
    const [adminTm] = await db
      .select()
      .from(teamMembers)
      .where(
        and(eq(teamMembers.teamId, teamRow.id), eq(teamMembers.userId, actorId))
      )
      .limit(1);
    if (!adminTm) {
      await db.insert(teamMembers).values({
        teamId: teamRow.id,
        userId: actorId,
        role: "lead",
      });
    }

    // If leadEmail already corresponds to a registered user, assign them as lead on this team
    if (t.leadEmail) {
      const [leadUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, t.leadEmail))
        .limit(1);
      if (leadUser) {
        const [om] = await db
          .select()
          .from(orgMembers)
          .where(
            and(
              eq(orgMembers.orgId, state.orgId),
              eq(orgMembers.userId, leadUser.id)
            )
          )
          .limit(1);
        if (!om) {
          await db.insert(orgMembers).values({
            orgId: state.orgId,
            userId: leadUser.id,
            role: "member",
          });
        }
        const [tm] = await db
          .select()
          .from(teamMembers)
          .where(
            and(
              eq(teamMembers.teamId, teamRow.id),
              eq(teamMembers.userId, leadUser.id)
            )
          )
          .limit(1);
        if (!tm) {
          await db.insert(teamMembers).values({
            teamId: teamRow.id,
            userId: leadUser.id,
            role: "lead",
          });
        } else if (tm.role !== "lead") {
          await db
            .update(teamMembers)
            .set({ role: "lead" })
            .where(eq(teamMembers.id, tm.id));
        }
      }
    }

    savedTeams.push({ ...teamRow, leadEmail: t.leadEmail });
  }

  const nextCompleted = Array.from(new Set([...state.completedSteps, 3]));
  const nextDraft: SetupDraftData = {
    ...state.draftData,
    teams: savedTeams.map((st) => ({
      id: st.id,
      name: st.name,
      slug: st.slug,
      description: st.description,
      leadEmail: st.leadEmail,
    })),
  };

  const [updatedState] = await db
    .update(setupState)
    .set({
      currentStep: 4,
      completedSteps: nextCompleted,
      draftData: nextDraft,
      updatedAt: new Date(),
    })
    .where(eq(setupState.id, "default"))
    .returning();

  return { teams: savedTeams, state: updatedState };
}


export async function runSetupStep4Employees(
  actorId: string,
  input: { employees: SetupDraftEmployee[] }
) {
  const state = await assertSetupAdminAccess(actorId);
  if (!state.orgId) {
    throw new ValidationError("Complete Step 2 (Organization) first", {
      org: "Organization is required",
    });
  }

  const orgTeams = await db
    .select()
    .from(teams)
    .where(eq(teams.orgId, state.orgId))
    .orderBy(asc(teams.createdAt));

  if (orgTeams.length === 0) {
    throw new ValidationError("Create at least one team in Step 3 first", {
      teams: "At least one team is required",
    });
  }

  const rawEmployees = Array.isArray(input.employees) ? input.employees : [];
  const rowErrors: Array<{
    row: number;
    email?: string;
    field: string;
    message: string;
  }> = [];

  const [adminUser] = state.adminUserId
    ? await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, state.adminUserId))
      .limit(1)
    : [null];
  const adminEmail = adminUser
    ? normalizeEmail(adminUser.email)
    : (state.draftData.admin?.email ? normalizeEmail(state.draftData.admin.email) : "");
  const adminName = adminUser?.name || state.draftData.admin?.name || "Setup Admin";

  const seenEmails = new Map<string, { row: number; name: string }>();

  const validated: Array<{
    id?: string;
    userId?: string;
    name: string;
    email: string;
    role: "admin" | "lead" | "member" | "viewer";
    team: typeof orgTeams[number];
    password: string;
    wasGenerated: boolean;
  }> = [];

  for (let i = 0; i < rawEmployees.length; i++) {
    const item = rawEmployees[i];
    const rowNum = i + 1;
    const name = (item.name || "").trim();
    const email = normalizeEmail(item.email);
    const role = normalizeRoleInput(String(item.role || ""));
    const teamRef = (item.teamSlug || "").trim();
    const rawPass = (item.temporaryPassword || "").trim();

    if (!name) {
      rowErrors.push({
        row: rowNum,
        email,
        field: "name",
        message: `Row ${rowNum}: Name is required`,
      });
    }
    if (!email || !isValidEmailFormat(email)) {
      rowErrors.push({
        row: rowNum,
        email,
        field: "email",
        message: `Row ${rowNum}: Valid email is required`,
      });
    } else if (adminEmail && email === adminEmail) {
      rowErrors.push({
        row: rowNum,
        email,
        field: "email",
        message: `This email is already used by ${adminName}.`,
      });
    } else if (seenEmails.has(email)) {
      const prior = seenEmails.get(email)!;
      rowErrors.push({
        row: rowNum,
        email,
        field: "email",
        message: `This email is already used by ${prior.name || "another employee"}.`,
      });
    } else {
      seenEmails.set(email, { row: rowNum, name });
    }

    if (!role) {
      rowErrors.push({
        row: rowNum,
        email,
        field: "role",
        message: `Row ${rowNum}: Role must be admin, team lead, member, or viewer`,
      });
    }

    let matchedTeam = orgTeams[0];
    if (teamRef) {
      const found = orgTeams.find(
        (t) =>
          t.slug.toLowerCase() === teamRef.toLowerCase() ||
          t.name.toLowerCase() === teamRef.toLowerCase() ||
          t.id === teamRef
      );
      if (!found) {
        rowErrors.push({
          row: rowNum,
          email,
          field: "teamSlug",
          message: `Row ${rowNum}: Unknown team '${teamRef}'`,
        });
      } else {
        matchedTeam = found;
      }
    }

    const [existingUser] = email
      ? await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = lower(${email})`)
        .limit(1)
      : [];

    if (existingUser) {
      if (existingUser.id === state.adminUserId) {
        if (!rowErrors.some((e) => e.row === rowNum && e.field === "email")) {
          rowErrors.push({
            row: rowNum,
            email,
            field: "email",
            message: `This email is already used by ${existingUser.name}.`,
          });
        }
      } else if (
        (item.id && item.id !== existingUser.id) ||
        (item.userId && item.userId !== existingUser.id)
      ) {
        if (!rowErrors.some((e) => e.row === rowNum && e.field === "email")) {
          rowErrors.push({
            row: rowNum,
            email,
            field: "email",
            message: `This email is already used by ${existingUser.name}.`,
          });
        }
      }
    }

    let password = rawPass;
    let wasGenerated = false;
    if (!password) {
      if (!existingUser) {
        password = generateSystemPassword(name);
        wasGenerated = true;
      }
    } else if (password.length < 8) {
      rowErrors.push({
        row: rowNum,
        email,
        field: "temporaryPassword",
        message: `Row ${rowNum}: Temporary password must be at least 8 characters`,
      });
    }

    if (
      name &&
      email &&
      isValidEmailFormat(email) &&
      role &&
      matchedTeam &&
      (!rawPass || rawPass.length >= 8)
    ) {
      validated.push({
        id: item.id,
        userId: item.userId,
        name,
        email,
        role,
        team: matchedTeam,
        password,
        wasGenerated,
      });
    }
  }

  if (rowErrors.length > 0) {
    const emailErr = rowErrors.find((e) => e.field === "email" && e.message.includes("already used by"));
    if (emailErr) {
      throw new EmailTakenError(emailErr.message);
    }
    const fieldMap: Record<string, string> = {};
    for (const err of rowErrors) {
      fieldMap[`employees.${err.row - 1}.${err.field}`] = err.message;
    }
    throw new ValidationError(rowErrors[0].message, fieldMap, rowErrors);
  }

  const provisionedCredentials: Array<{
    name: string;
    email: string;
    role: string;
    teamSlug: string;
    temporaryPassword?: string;
    mustChangePassword: boolean;
  }> = [];

  for (const emp of validated) {
    const [existingUser] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${emp.email})`)
      .limit(1);

    let userId: string;
    const isSelfAdmin = existingUser?.id === actorId;

    if (!existingUser) {
      const passwordHash = await hashPassword(emp.password);
      const [created] = await db
        .insert(users)
        .values({
          email: emp.email,
          name: emp.name,
          passwordHash,
          mustChangePassword: true,
          isSetupAdmin: false,
        })
        .returning();
      userId = created.id;
    } else {
      userId = existingUser.id;
      const updates: Partial<typeof users.$inferInsert> = { name: emp.name };
      if (emp.password && !isSelfAdmin) {
        updates.passwordHash = await hashPassword(emp.password);
        updates.mustChangePassword = true;
      }
      await db.update(users).set(updates).where(eq(users.id, existingUser.id));
    }

    if (emp.password && !isSelfAdmin) {
      const enc = encryptSetupToken(emp.password);
      await db
        .insert(setupCredentials)
        .values({
          userId,
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          authTag: enc.authTag,
        })
        .onConflictDoUpdate({
          target: setupCredentials.userId,
          set: {
            ciphertext: enc.ciphertext,
            iv: enc.iv,
            authTag: enc.authTag,
            createdAt: new Date(),
          },
        });
    }

    // Org membership
    const targetOrgRole = emp.role === "admin" || isSelfAdmin ? "admin" : "member";
    const [existingOm] = await db
      .select()
      .from(orgMembers)
      .where(
        and(eq(orgMembers.orgId, state.orgId), eq(orgMembers.userId, userId))
      )
      .limit(1);
    if (!existingOm) {
      await db.insert(orgMembers).values({
        orgId: state.orgId,
        userId,
        role: targetOrgRole,
      });
    } else if (existingOm.role !== targetOrgRole) {
      await db
        .update(orgMembers)
        .set({ role: targetOrgRole })
        .where(eq(orgMembers.id, existingOm.id));
    }

    // Team membership
    const targetTeamRole: TeamRole =
      emp.role === "admin" || emp.role === "lead" ? "lead" : emp.role;
    const [existingTm] = await db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, emp.team.id),
          eq(teamMembers.userId, userId)
        )
      )
      .limit(1);
    if (!existingTm) {
      await db.insert(teamMembers).values({
        teamId: emp.team.id,
        userId,
        role: targetTeamRole,
      });
    } else if (existingTm.role !== targetTeamRole) {
      await db
        .update(teamMembers)
        .set({ role: targetTeamRole })
        .where(eq(teamMembers.id, existingTm.id));
    }

    // Check if any team in draftData.teams designated this email as leadEmail
    const draftTeams = state.draftData.teams || [];
    for (const dt of draftTeams) {
      if (dt.leadEmail && dt.leadEmail.trim().toLowerCase() === emp.email) {
        const matchingTeam = orgTeams.find(
          (ot) => ot.slug === dt.slug || ot.id === dt.id
        );
        if (matchingTeam) {
          const [leadTm] = await db
            .select()
            .from(teamMembers)
            .where(
              and(
                eq(teamMembers.teamId, matchingTeam.id),
                eq(teamMembers.userId, userId)
              )
            )
            .limit(1);
          if (!leadTm) {
            await db.insert(teamMembers).values({
              teamId: matchingTeam.id,
              userId,
              role: "lead",
            });
          } else if (leadTm.role !== "lead") {
            await db
              .update(teamMembers)
              .set({ role: "lead" })
              .where(eq(teamMembers.id, leadTm.id));
          }
        }
      }
    }

    provisionedCredentials.push({
      name: emp.name,
      email: emp.email,
      role: emp.role,
      teamSlug: emp.team.slug,
      temporaryPassword: emp.password || undefined,
      mustChangePassword: !isSelfAdmin,
    });
  }

  const nextCompleted = Array.from(new Set([...state.completedSteps, 4]));
  const nextSkipped = state.skippedSteps.filter((s) => s !== 4);
  const nextDraft: SetupDraftData = {
    ...state.draftData,
    employees: provisionedCredentials.map((c) => ({
      name: c.name,
      email: c.email,
      role: c.role as "admin" | "lead" | "member" | "viewer",
      teamSlug: c.teamSlug,
    })),
  };

  const [updatedState] = await db
    .update(setupState)
    .set({
      currentStep: 5,
      completedSteps: nextCompleted,
      skippedSteps: nextSkipped,
      draftData: nextDraft,
      updatedAt: new Date(),
    })
    .where(eq(setupState.id, "default"))
    .returning();

  return {
    employees: provisionedCredentials,
    state: updatedState,
  };
}

export interface EmployeeCsvSkippedRow {
  line: number;
  row: number;
  email: string;
  reason: "already exists" | "duplicate in file" | string;
}


export async function runSetupStep5Projects(
  actorId: string,
  input: { projects: SetupDraftProject[] }
) {
  const state = await assertSetupAdminAccess(actorId);
  if (!state.orgId) {
    throw new ValidationError("Complete Step 2 (Organization) first", {
      org: "Organization is required",
    });
  }

  const orgTeams = await db
    .select()
    .from(teams)
    .where(eq(teams.orgId, state.orgId))
    .orderBy(asc(teams.createdAt));

  if (orgTeams.length === 0) {
    throw new ValidationError("Create at least one team in Step 3 first", {
      teams: "At least one team is required",
    });
  }

  const items = Array.isArray(input.projects) ? input.projects : [];
  if (items.length === 0) {
    throw new ValidationError(
      "Add at least one project or click 'Skip for now'",
      { projects: "Add at least one project or skip this step" }
    );
  }

  const existingProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.orgId, state.orgId))
    .orderBy(asc(projects.createdAt));

  const savedProjects = [];

  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    const name = (raw.name || "").trim();
    const key = (raw.key || name.slice(0, 4))
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 10);
    const description = (raw.description || "").trim();
    const teamRef = (raw.teamSlug || "").trim();

    if (!name) {
      throw new ValidationError(`Project #${i + 1}: Name is required`, {
        [`projects.${i}.name`]: "Project name is required",
      });
    }
    if (key.length < 2) {
      throw new ValidationError(
        `Project #${i + 1}: Key must be 2–10 alphanumeric characters`,
        {
          [`projects.${i}.key`]: "Key must be 2–10 uppercase characters",
        }
      );
    }

    const matchedTeam = teamRef
      ? orgTeams.find(
        (t) =>
          t.slug.toLowerCase() === teamRef.toLowerCase() ||
          t.name.toLowerCase() === teamRef.toLowerCase() ||
          t.id === teamRef
      )
      : orgTeams[0];

    if (!matchedTeam) {
      throw new ValidationError(
        `Project #${i + 1}: Team '${teamRef}' not found`,
        { [`projects.${i}.teamSlug`]: `Team '${teamRef}' not found` }
      );
    }

    const match =
      (raw.id ? existingProjects.find((ep) => ep.id === raw.id) : undefined) ||
      existingProjects.find(
        (ep) => ep.teamId === matchedTeam.id && ep.key === key
      );

    let projRow: typeof projects.$inferSelect;
    if (match) {
      const [updated] = await db
        .update(projects)
        .set({
          teamId: matchedTeam.id,
          name,
          key,
          description,
        })
        .where(eq(projects.id, match.id))
        .returning();
      projRow = updated;
    } else {
      const [created] = await db
        .insert(projects)
        .values({
          orgId: state.orgId,
          teamId: matchedTeam.id,
          name,
          key,
          description,
        })
        .returning();
      projRow = created;
    }

    savedProjects.push({
      ...projRow,
      teamSlug: matchedTeam.slug,
    });
  }

  const nextCompleted = Array.from(new Set([...state.completedSteps, 5]));
  const nextSkipped = state.skippedSteps.filter((s) => s !== 5);
  const nextDraft: SetupDraftData = {
    ...state.draftData,
    projects: savedProjects.map((p) => ({
      id: p.id,
      teamSlug: p.teamSlug,
      name: p.name,
      key: p.key,
      description: p.description,
    })),
  };

  const [updatedState] = await db
    .update(setupState)
    .set({
      currentStep: 6,
      completedSteps: nextCompleted,
      skippedSteps: nextSkipped,
      draftData: nextDraft,
      updatedAt: new Date(),
    })
    .where(eq(setupState.id, "default"))
    .returning();

  return { projects: savedProjects, state: updatedState };
}

export async function runSetupStep6Boards(
  actorId: string,
  input: { boards: SetupDraftBoard[] }
) {
  const state = await assertSetupAdminAccess(actorId);
  if (!state.orgId) {
    throw new ValidationError("Complete Step 2 (Organization) first", {
      org: "Organization is required",
    });
  }

  const orgProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.orgId, state.orgId))
    .orderBy(asc(projects.createdAt));

  if (orgProjects.length === 0) {
    throw new ValidationError(
      "Create at least one project in Step 5 before creating boards, or skip Step 6",
      { projects: "No projects exist yet" }
    );
  }

  const items = Array.isArray(input.boards) ? input.boards : [];
  if (items.length === 0) {
    throw new ValidationError(
      "Add at least one board or click 'Skip for now'",
      { boards: "Add at least one board or skip this step" }
    );
  }

  const existingBoards = await db
    .select()
    .from(boards)
    .where(eq(boards.orgId, state.orgId))
    .orderBy(asc(boards.createdAt));

  const savedBoards = [];

  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    const name = (raw.name || "").trim();
    const description = (raw.description || "").trim();
    const projRef = (raw.projectKey || "").trim();
    const rawCols =
      Array.isArray(raw.columns) && raw.columns.length > 0
        ? raw.columns
        : DEFAULT_SETUP_COLUMNS;

    if (!name) {
      throw new ValidationError(`Board #${i + 1}: Name is required`, {
        [`boards.${i}.name`]: "Board name is required",
      });
    }

    const matchedProject = projRef
      ? orgProjects.find(
        (p) =>
          p.key.toLowerCase() === projRef.toLowerCase() ||
          p.name.toLowerCase() === projRef.toLowerCase() ||
          p.id === projRef
      )
      : orgProjects[0];

    if (!matchedProject) {
      throw new ValidationError(
        `Board #${i + 1}: Project '${projRef}' not found`,
        { [`boards.${i}.projectKey`]: `Project '${projRef}' not found` }
      );
    }

    for (let cIdx = 0; cIdx < rawCols.length; cIdx++) {
      if (!(rawCols[cIdx].name || "").trim()) {
        throw new ValidationError(
          `Board #${i + 1}, Column #${cIdx + 1}: Column name is required`,
          { [`boards.${i}.columns.${cIdx}.name`]: "Column name is required" }
        );
      }
    }

    const match =
      (raw.id ? existingBoards.find((eb) => eb.id === raw.id) : undefined) ||
      existingBoards.find(
        (eb) =>
          eb.projectId === matchedProject.id &&
          eb.name.toLowerCase() === name.toLowerCase()
      );

    let boardRow: typeof boards.$inferSelect;
    if (match) {
      const [updated] = await db
        .update(boards)
        .set({
          projectId: matchedProject.id,
          teamId: matchedProject.teamId,
          name,
          description,
        })
        .where(eq(boards.id, match.id))
        .returning();
      boardRow = updated;
    } else {
      const [created] = await db
        .insert(boards)
        .values({
          orgId: state.orgId,
          teamId: matchedProject.teamId,
          projectId: matchedProject.id,
          name,
          description,
        })
        .returning();
      boardRow = created;
    }

    const existingCols = await db
      .select()
      .from(columns)
      .where(eq(columns.boardId, boardRow.id))
      .orderBy(asc(columns.position));

    const syncedCols = [];
    for (let cIdx = 0; cIdx < rawCols.length; cIdx++) {
      const rc = rawCols[cIdx];
      const colName = rc.name.trim();
      const wipLimit =
        rc.wipLimit !== undefined && rc.wipLimit !== null && Number(rc.wipLimit) > 0
          ? Number(rc.wipLimit)
          : null;
      const color =
        rc.color ||
        DEFAULT_SETUP_COLUMNS[cIdx]?.color ||
        "#64748B";

      const colMatch =
        (rc.id ? existingCols.find((ec) => ec.id === rc.id) : undefined) ||
        existingCols[cIdx];

      if (colMatch) {
        const [updatedCol] = await db
          .update(columns)
          .set({
            name: colName,
            position: cIdx,
            wipLimit,
            color,
          })
          .where(eq(columns.id, colMatch.id))
          .returning();
        syncedCols.push(updatedCol);
      } else {
        const [createdCol] = await db
          .insert(columns)
          .values({
            boardId: boardRow.id,
            name: colName,
            position: cIdx,
            wipLimit,
            color,
          })
          .returning();
        syncedCols.push(createdCol);
      }
    }

    savedBoards.push({
      ...boardRow,
      projectKey: matchedProject.key,
      columns: syncedCols,
    });
  }

  const nextCompleted = Array.from(new Set([...state.completedSteps, 6]));
  const nextSkipped = state.skippedSteps.filter((s) => s !== 6);
  const nextDraft: SetupDraftData = {
    ...state.draftData,
    boards: savedBoards.map((b) => ({
      id: b.id,
      projectKey: b.projectKey,
      name: b.name,
      description: b.description,
      columns: b.columns.map((c) => ({
        id: c.id,
        name: c.name,
        wipLimit: c.wipLimit,
        color: c.color,
      })),
    })),
  };

  const [updatedState] = await db
    .update(setupState)
    .set({
      currentStep: 7,
      completedSteps: nextCompleted,
      skippedSteps: nextSkipped,
      draftData: nextDraft,
      updatedAt: new Date(),
    })
    .where(eq(setupState.id, "default"))
    .returning();

  return { boards: savedBoards, state: updatedState };
}
