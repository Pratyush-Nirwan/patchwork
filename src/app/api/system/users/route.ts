import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, orgMembers, teamMembers, teams } from "@/db/schema";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import { normalizeEmail, isValidEmailFormat, EmailTakenError } from "@/lib/email";
import { hashPassword, validatePasswordAgainstPolicy } from "@/lib/auth";
import { generateSystemPassword, generateCryptoPassword } from "@/lib/setup";
import { AppError } from "@/lib/errors";

export async function GET(req: NextRequest) {
  try {
    const { orgId } = await requireAdminAuth(req);
    const searchParams = req.nextUrl.searchParams;

    const search = searchParams.get("search")?.trim().toLowerCase() || "";
    const roleFilter = searchParams.get("role");
    const teamIdFilter = searchParams.get("teamId");
    const statusFilter = searchParams.get("status"); // "all", "active", "deactivated"
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));
    const sortField = searchParams.get("sort") || "createdAt";
    const sortOrder = searchParams.get("order") === "asc" ? "asc" : "desc";

    // Query all members in this org
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        isDeactivated: users.isDeactivated,
        mustChangePassword: users.mustChangePassword,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        orgRole: orgMembers.role,
      })
      .from(users)
      .innerJoin(orgMembers, eq(orgMembers.userId, users.id))
      .where(
        and(
          eq(orgMembers.orgId, orgId),
          search
            ? sql`(lower(${users.name}) LIKE ${`%${search}%`} OR lower(${users.email}) LIKE ${`%${search}%`})`
            : undefined,
          statusFilter === "active"
            ? eq(users.isDeactivated, false)
            : statusFilter === "deactivated"
            ? eq(users.isDeactivated, true)
            : undefined
        )
      );

    // Fetch team memberships for this org
    const allTeamRows = await db
      .select({
        userId: teamMembers.userId,
        teamId: teams.id,
        teamName: teams.name,
        teamRole: teamMembers.role,
        subRole: teamMembers.subRole,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teams.orgId, orgId));

    // Fetch all teams in org for filter/assignment
    const orgTeams = await db
      .select({
        id: teams.id,
        name: teams.name,
      })
      .from(teams)
      .where(eq(teams.orgId, orgId));

    const teamsByUser = new Map<
      string,
      Array<{ id: string; name: string; role: string; subRole?: string | null }>
    >();
    for (const t of allTeamRows) {
      const list = teamsByUser.get(t.userId) || [];
      list.push({ id: t.teamId, name: t.teamName, role: t.teamRole, subRole: t.subRole });
      teamsByUser.set(t.userId, list);
    }

    let userList = rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.orgRole,
      status: u.isDeactivated ? ("deactivated" as const) : ("active" as const),
      mustChangePassword: u.mustChangePassword,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      teams: teamsByUser.get(u.id) || [],
    }));

    // Filter by role: Admin, Lead, Member, Viewer
    if (roleFilter && roleFilter !== "all") {
      const rf = roleFilter.toLowerCase();
      if (rf === "admin") {
        userList = userList.filter((u) => u.role === "admin");
      } else if (rf === "lead" || rf === "member" || rf === "viewer") {
        userList = userList.filter(
          (u) =>
            u.role !== "admin" &&
            u.teams.some((t) => t.role.toLowerCase() === rf)
        );
      }
    }

    if (teamIdFilter && teamIdFilter !== "all") {
      userList = userList.filter((u) =>
        u.teams.some((t) => t.id === teamIdFilter)
      );
    }

    const getRoleRank = (u: {
      role: string;
      teams: Array<{ role: string }>;
    }): number => {
      if (u.role === "admin") return 4;
      if (u.teams.some((t) => t.role.toLowerCase() === "lead")) return 3;
      if (u.teams.some((t) => t.role.toLowerCase() === "member")) return 2;
      if (u.teams.some((t) => t.role.toLowerCase() === "viewer")) return 1;
      return 0; // no team
    };

    // Sort
    userList.sort((a, b) => {
      let valA: string | number | Date = a.name;
      let valB: string | number | Date = b.name;
      if (sortField === "email") {
        valA = a.email;
        valB = b.email;
      } else if (sortField === "role") {
        valA = getRoleRank(a);
        valB = getRoleRank(b);
      } else if (sortField === "createdAt") {
        valA = a.createdAt;
        valB = b.createdAt;
      } else if (sortField === "lastLoginAt") {
        valA = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
        valB = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
      }

      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    const total = userList.length;
    const paginated = userList.slice((page - 1) * pageSize, page * pageSize);

    return NextResponse.json({
      users: paginated,
      availableTeams: orgTeams,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { orgId } = await requireAdminAuth(req);
    const body = await req.json();

    const name = String(body.name || "").trim();
    const rawEmail = String(body.email || "").trim();
    const email = normalizeEmail(rawEmail);
    const role = (body.role || "member") as "admin" | "member";
    const teamsInput = Array.isArray(body.teams) ? body.teams : [];
    const passwordOption = body.passwordOption || "system"; // "system" | "random" | "custom"

    if (!name) {
      throw new AppError("Name is required", 400, "INVALID_NAME");
    }
    if (!email || !isValidEmailFormat(email)) {
      throw new AppError("Valid email is required", 400, "INVALID_EMAIL");
    }

    // Check duplicate email
    const [existing] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);

    if (existing) {
      throw new EmailTakenError(
        `This email is already used by ${existing.name}.`,
        existing.name
      );
    }

    let password = "";
    if (passwordOption === "system") {
      password = generateSystemPassword(name);
    } else if (passwordOption === "random") {
      password = generateCryptoPassword(16);
    } else {
      password = String(body.customPassword || "");
    }

    await validatePasswordAgainstPolicy(password);
    const passwordHash = await hashPassword(password);

    const [newUser] = await db
      .insert(users)
      .values({
        email,
        name,
        passwordHash,
        mustChangePassword: true,
        isSetupAdmin: false,
        isDeactivated: false,
      })
      .returning();

    // Assign to org
    await db.insert(orgMembers).values({
      orgId,
      userId: newUser.id,
      role,
    });

    // Assign to teams
    for (const t of teamsInput) {
      if (t.teamId) {
        const teamRole = t.role || "member";
        const validSubRoles = ["developer", "tester", "designer", "devops", "general"];
        const subRole = teamRole === "member"
          ? (validSubRoles.includes(t.subRole) ? t.subRole : "developer")
          : null;
        await db
          .insert(teamMembers)
          .values({
            teamId: t.teamId,
            userId: newUser.id,
            role: teamRole,
            subRole,
          })
          .onConflictDoNothing();
      }
    }

    return NextResponse.json(
      {
        user: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          role,
          status: "active",
          mustChangePassword: true,
          createdAt: newUser.createdAt,
        },
        generatedPassword: password,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
