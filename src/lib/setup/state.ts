import crypto from "crypto";
import { eq,and,asc,sql } from "drizzle-orm";
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
type SetupDraftData,type SetupDraftColumn
} from "@/db/schema";
import { AppError,ForbiddenError } from "../errors";
import { normalizeEmail,EmailTakenError } from "../email";

export const SETUP_NOTICE =
  "Setup takes some time. Every step is saved automatically, so you can close this page and resume whenever you want.";

export const DEFAULT_SETUP_COLUMNS: SetupDraftColumn[] = [
  { name: "Backlog", wipLimit: null, color: "#434B56" },
  { name: "In Progress", wipLimit: 5, color: "#C84317" },
  { name: "Review", wipLimit: 3, color: "#C2410C" },
  { name: "Done", wipLimit: null, color: "#15803D" },
];

export class ValidationError extends AppError {
  fields: Record<string, string>;
  rowErrors?: Array<{ row: number; email?: string; field: string; message: string }>;

  constructor(
    message: string,
    fields: Record<string, string> = {},
    rowErrors?: Array<{ row: number; email?: string; field: string; message: string }>
  ) {
    super(message, 400, "VALIDATION_ERROR");
    this.fields = fields;
    this.rowErrors = rowErrors;
  }
}

export function generateSystemPassword(name?: string): string {
  const raw = (name || "").trim();
  const asciiOnly = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z\s]/g, "")
    .trim();

  const words = asciiOnly.split(/\s+/).filter(Boolean);
  const firstName = words[0] || "User";
  let lastNameInitial = "";
  if (words.length > 1) {
    lastNameInitial = words[1][0].toUpperCase();
  } else if (firstName.length > 1) {
    lastNameInitial = firstName[firstName.length - 1].toUpperCase();
  } else {
    lastNameInitial = "X";
  }

  let formattedFirst =
    firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();

  if (formattedFirst.length < 2) {
    formattedFirst = `${formattedFirst}x`;
  }

  const digits = crypto.randomInt(1000, 10000).toString();
  return `${formattedFirst}${lastNameInitial}@${digits}`;
}

export function generateCryptoPassword(length = 16): string {
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*";
  const all = uppercase + lowercase + digits + symbols;

  const required = [
    uppercase[crypto.randomInt(0, uppercase.length)],
    lowercase[crypto.randomInt(0, lowercase.length)],
    digits[crypto.randomInt(0, digits.length)],
    symbols[crypto.randomInt(0, symbols.length)],
  ];

  const remaining: string[] = [];
  for (let i = 0; i < length - required.length; i++) {
    remaining.push(all[crypto.randomInt(0, all.length)]);
  }

  const combined = [...required, ...remaining];
  for (let i = combined.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }

  return combined.join("");
}

export async function getOrCreateSetupState() {
  const [existing] = await db
    .select()
    .from(setupState)
    .where(eq(setupState.id, "default"))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [firstUser] = await db
    .select()
    .from(users)
    .orderBy(asc(users.createdAt))
    .limit(1);

  const [firstOrg] = await db
    .select()
    .from(orgs)
    .orderBy(asc(orgs.createdAt))
    .limit(1);

  const [created] = await db
    .insert(setupState)
    .values({
      id: "default",
      adminUserId: firstUser?.id ?? null,
      orgId: firstOrg?.id ?? null,
      currentStep: firstUser ? (firstOrg ? 3 : 2) : 1,
      completedSteps: firstUser ? (firstOrg ? [1, 2] : [1]) : [],
      skippedSteps: [],
      draftData: {},
      isCompleted: false,
    })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  const [refetched] = await db
    .select()
    .from(setupState)
    .where(eq(setupState.id, "default"))
    .limit(1);
  return refetched!;
}

export async function getSetupStatus() {
  const state = await getOrCreateSetupState();
  const [anyUser] = await db.select({ id: users.id }).from(users).limit(1);
  return {
    isCompleted: state.isCompleted,
    hasAdmin: Boolean(state.adminUserId || anyUser),
    currentStep: state.currentStep,
  };
}

export async function isUserSetupAdmin(userId: string): Promise<boolean> {
  const state = await getOrCreateSetupState();
  if (state.adminUserId === userId) return true;
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (u?.isSetupAdmin) return true;
  if (state.orgId) {
    const [membership] = await db
      .select()
      .from(orgMembers)
      .where(
        and(
          eq(orgMembers.orgId, state.orgId),
          eq(orgMembers.userId, userId),
          eq(orgMembers.role, "admin")
        )
      )
      .limit(1);
    if (membership) return true;
  }
  return false;
}

export async function assertSetupAdminAccess(
  actorId: string | null | undefined,
  options?: { allowWhenCompleted?: boolean }
) {
  const state = await getOrCreateSetupState();
  if (state.isCompleted && !options?.allowWhenCompleted) {
    throw new ForbiddenError("Setup is already completed and locked");
  }
  if (!actorId) {
    throw new ForbiddenError("Authentication required to continue setup");
  }
  const allowed = await isUserSetupAdmin(actorId);
  if (!allowed) {
    throw new ForbiddenError("Only the organization administrator can access setup");
  }
  return state;
}

export async function buildSetupSummary(orgId: string | null, adminUserId: string | null) {
  let adminUser: { id: string; name: string; email: string } | null = null;
  if (adminUserId) {
    const [u] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, adminUserId))
      .limit(1);
    adminUser = u || null;
  }

  if (!orgId) {
    return {
      admin: adminUser,
      org: null,
      teams: [],
      employees: [],
      projects: [],
      boards: [],
    };
  }

  const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
  const orgTeams = await db
    .select()
    .from(teams)
    .where(eq(teams.orgId, orgId))
    .orderBy(asc(teams.createdAt));

  const allOrgMembers = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      orgRole: orgMembers.role,
      mustChangePassword: users.mustChangePassword,
    })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(eq(orgMembers.orgId, orgId))
    .orderBy(asc(users.createdAt));

  const allTeamMembers = await db
    .select({
      teamId: teamMembers.teamId,
      userId: teamMembers.userId,
      role: teamMembers.role,
      email: users.email,
      name: users.name,
    })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(eq(teams.orgId, orgId));

  const teamsWithLeads = orgTeams.map((t) => {
    const leadMember =
      allTeamMembers.find(
        (tm) =>
          tm.teamId === t.id &&
          tm.role === "lead" &&
          tm.userId !== adminUserId
      ) ||
      allTeamMembers.find((tm) => tm.teamId === t.id && tm.role === "lead");
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      description: t.description,
      leadEmail: leadMember?.email || "",
      leadName: leadMember?.name || "",
    };
  });

  const employees = allOrgMembers
    .filter((m) => m.userId !== adminUserId)
    .map((m) => {
      const tm = allTeamMembers.find((t) => t.userId === m.userId);
      const teamObj = tm ? orgTeams.find((ot) => ot.id === tm.teamId) : undefined;
      return {
        id: m.userId,
        name: m.name,
        email: m.email,
        role: (m.orgRole === "admin" ? "admin" : tm?.role || "member") as
          | "admin"
          | "lead"
          | "member"
          | "viewer",
        teamSlug: teamObj?.slug || "",
        teamName: teamObj?.name || "",
        mustChangePassword: m.mustChangePassword,
      };
    });

  const orgProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.orgId, orgId))
    .orderBy(asc(projects.createdAt));

  const enrichedProjects = orgProjects.map((p) => {
    const teamObj = orgTeams.find((t) => t.id === p.teamId);
    return {
      id: p.id,
      teamId: p.teamId,
      teamSlug: teamObj?.slug || "",
      teamName: teamObj?.name || "",
      name: p.name,
      key: p.key,
      description: p.description,
    };
  });

  const orgBoards = await db
    .select()
    .from(boards)
    .where(eq(boards.orgId, orgId))
    .orderBy(asc(boards.createdAt));

  const enrichedBoards = [];
  for (const b of orgBoards) {
    const bCols = await db
      .select()
      .from(columns)
      .where(eq(columns.boardId, b.id))
      .orderBy(asc(columns.position));
    const projObj = orgProjects.find((p) => p.id === b.projectId);
    enrichedBoards.push({
      id: b.id,
      projectId: b.projectId,
      projectKey: projObj?.key || "",
      projectName: projObj?.name || "",
      name: b.name,
      description: b.description,
      columns: bCols.map((c) => ({
        id: c.id,
        name: c.name,
        wipLimit: c.wipLimit,
        color: c.color,
      })),
    });
  }

  return {
    admin: adminUser,
    org: org
      ? {
        id: org.id,
        name: org.name,
        slug: org.slug,
        description: org.description,
      }
      : null,
    teams: teamsWithLeads,
    employees,
    projects: enrichedProjects,
    boards: enrichedBoards,
  };
}

export async function getSetupSnapshotForUser(actorId?: string | null) {
  const state = await getOrCreateSetupState();
  const [anyUser] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .orderBy(asc(users.createdAt))
    .limit(1);

  const effectiveAdminId = state.adminUserId || anyUser?.id || null;

  if (state.isCompleted) {
    return {
      notice: SETUP_NOTICE,
      isCompleted: true,
      hasAdmin: Boolean(effectiveAdminId),
      requiresAuth: false,
      currentStep: 7,
      completedSteps: state.completedSteps,
      skippedSteps: state.skippedSteps,
      draftData: state.draftData,
      summary: await buildSetupSummary(state.orgId, effectiveAdminId),
    };
  }

  if (!effectiveAdminId) {
    return {
      notice: SETUP_NOTICE,
      isCompleted: false,
      hasAdmin: false,
      requiresAuth: false,
      currentStep: 1,
      completedSteps: state.completedSteps,
      skippedSteps: state.skippedSteps,
      draftData: state.draftData,
      summary: {
        admin: null,
        org: null,
        teams: [],
        employees: [],
        projects: [],
        boards: [],
      },
    };
  }

  if (!actorId) {
    return {
      notice: SETUP_NOTICE,
      isCompleted: false,
      hasAdmin: true,
      requiresAuth: true,
      adminEmailHint: anyUser?.email || "",
      currentStep: state.currentStep,
      completedSteps: state.completedSteps,
      skippedSteps: state.skippedSteps,
      draftData: {} as SetupDraftData,
      summary: null,
    };
  }

  await assertSetupAdminAccess(actorId);
  const summary = await buildSetupSummary(state.orgId, effectiveAdminId);

  // Merge DB entities into draftData so resuming always restores both saved DB items and unsaved draft edits
  const mergedDraft: SetupDraftData = {
    admin: state.draftData.admin || (summary.admin ? { name: summary.admin.name, email: summary.admin.email } : undefined),
    org:
      state.draftData.org ||
      (summary.org
        ? {
          name: summary.org.name,
          slug: summary.org.slug,
          description: summary.org.description,
        }
        : undefined),
    teams:
      state.draftData.teams && state.draftData.teams.length > 0
        ? state.draftData.teams
        : summary.teams.map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          description: t.description,
          leadEmail: t.leadEmail,
        })),
    employees:
      state.draftData.employees && state.draftData.employees.length > 0
        ? state.draftData.employees
        : summary.employees.map((e) => ({
          id: e.id,
          name: e.name,
          email: e.email,
          role: e.role,
          teamSlug: e.teamSlug,
        })),
    projects:
      state.draftData.projects && state.draftData.projects.length > 0
        ? state.draftData.projects
        : summary.projects.map((p) => ({
          id: p.id,
          teamSlug: p.teamSlug,
          name: p.name,
          key: p.key,
          description: p.description,
        })),
    boards:
      state.draftData.boards && state.draftData.boards.length > 0
        ? state.draftData.boards
        : summary.boards.map((b) => ({
          id: b.id,
          projectKey: b.projectKey,
          name: b.name,
          description: b.description,
          columns: b.columns,
        })),
    employeeVisibleColumns: state.draftData.employeeVisibleColumns,
  };

  return {
    notice: SETUP_NOTICE,
    isCompleted: false,
    hasAdmin: true,
    requiresAuth: false,
    currentStep: state.currentStep,
    completedSteps: state.completedSteps,
    skippedSteps: state.skippedSteps,
    draftData: mergedDraft,
    summary,
  };
}

export async function saveSetupDraft(
  actorId: string | null | undefined,
  input: {
    currentStep?: number;
    draftData?: Partial<SetupDraftData>;
  }
) {
  const state = await getOrCreateSetupState();
  if (state.isCompleted) {
    throw new ForbiddenError("Setup is already completed and locked");
  }

  const [anyUser] = await db.select({ id: users.id }).from(users).limit(1);
  if (state.adminUserId || anyUser) {
    await assertSetupAdminAccess(actorId);
  }

  const nextDraft: SetupDraftData = {
    ...state.draftData,
    ...(input.draftData || {}),
  };

  if (Array.isArray(input.draftData?.employees)) {
    const rawList = input.draftData.employees;
    const seen = new Map<string, string>();
    const adminEmail = nextDraft.admin?.email ? normalizeEmail(nextDraft.admin.email) : "";
    const adminName = nextDraft.admin?.name || "Setup Admin";

    for (let i = 0; i < rawList.length; i++) {
      const emp = rawList[i];
      const normEmail = normalizeEmail(emp.email);
      if (!normEmail) continue;

      if (adminEmail && normEmail === adminEmail) {
        throw new EmailTakenError(`This email is already used by ${adminName}.`, adminName);
      }

      if (seen.has(normEmail)) {
        const priorName = seen.get(normEmail) || "another employee";
        throw new EmailTakenError(`This email is already used by ${priorName}.`, priorName);
      }
      seen.set(normEmail, emp.name || "another employee");

      const [existing] = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(sql`lower(${users.email}) = lower(${normEmail})`)
        .limit(1);

      if (existing) {
        if (state.adminUserId && existing.id === state.adminUserId) {
          throw new EmailTakenError(`This email is already used by ${existing.name}.`, existing.name);
        }
        if (emp.id && emp.id !== existing.id) {
          throw new EmailTakenError(`This email is already used by ${existing.name}.`, existing.name);
        }
      }
    }
  }

  let nextStep = state.currentStep;
  if (
    typeof input.currentStep === "number" &&
    input.currentStep >= 1 &&
    input.currentStep <= 7
  ) {
    nextStep = input.currentStep;
  }

  const [updated] = await db
    .update(setupState)
    .set({
      currentStep: nextStep,
      draftData: nextDraft,
      updatedAt: new Date(),
    })
    .where(eq(setupState.id, "default"))
    .returning();

  return updated;
}


export async function skipSetupStep(actorId: string, step: number) {
  const state = await assertSetupAdminAccess(actorId);
  if (![4, 5, 6].includes(step)) {
    throw new ValidationError(
      `Step ${step} is required and cannot be skipped`,
      { step: `Step ${step} is required` }
    );
  }

  const nextSkipped = Array.from(new Set([...state.skippedSteps, step]));
  const nextStep = Math.min(7, step + 1);

  const [updatedState] = await db
    .update(setupState)
    .set({
      currentStep: nextStep,
      skippedSteps: nextSkipped,
      updatedAt: new Date(),
    })
    .where(eq(setupState.id, "default"))
    .returning();

  return updatedState;
}

export async function completeSetupWizard(actorId: string) {
  const state = await assertSetupAdminAccess(actorId);
  if (!state.orgId) {
    throw new ValidationError(
      "Step 2 (Organization) must be completed before finishing setup",
      { org: "Organization is required" }
    );
  }

  const orgTeams = await db
    .select()
    .from(teams)
    .where(eq(teams.orgId, state.orgId));

  if (orgTeams.length === 0) {
    throw new ValidationError(
      "Step 3 (Teams) must be completed with at least one team before finishing setup",
      { teams: "At least one team is required" }
    );
  }

  const nextCompleted = Array.from(new Set([...state.completedSteps, 1, 2, 3, 7]));
  const [updatedState] = await db
    .update(setupState)
    .set({
      currentStep: 7,
      completedSteps: nextCompleted,
      isCompleted: true,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(setupState.id, "default"))
    .returning();

  // Purge all setup credentials on completion
  await db.delete(setupCredentials);

  const summary = await buildSetupSummary(state.orgId, state.adminUserId || actorId);
  return { state: updatedState, summary };
}
