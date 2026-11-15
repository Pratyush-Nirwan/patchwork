import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, orgMembers, teamMembers, teams } from "@/db/schema";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";

export async function GET(req: NextRequest) {
  try {
    const { orgId } = await requireAdminAuth(req);

    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        isDeactivated: users.isDeactivated,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        role: orgMembers.role,
      })
      .from(users)
      .innerJoin(orgMembers, eq(orgMembers.userId, users.id))
      .where(eq(orgMembers.orgId, orgId));

    const allTeamRows = await db
      .select({
        userId: teamMembers.userId,
        teamName: teams.name,
        teamRole: teamMembers.role,
        subRole: teamMembers.subRole,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teams.orgId, orgId));

    const teamsByUser = new Map<
      string,
      Array<{ name: string; role: string; subRole?: string | null }>
    >();
    for (const t of allTeamRows) {
      const list = teamsByUser.get(t.userId) || [];
      list.push({ name: t.teamName, role: t.teamRole, subRole: t.subRole });
      teamsByUser.set(t.userId, list);
    }

    const escapeCsv = (val: string): string => {
      if (!val) return '""';
      let clean = val;
      // Formula injection guard: prepend single quote if starting with formula triggers
      if (/^[=+\-@\t\r]/.test(clean)) {
        clean = `'${clean}`;
      }
      return `"${clean.replace(/"/g, '""')}"`;
    };

    const capitalize = (s: string) => {
      if (s.toLowerCase() === "devops") return "DevOps";
      return s.charAt(0).toUpperCase() + s.slice(1);
    };

    const csvLines = [
      "id,name,email,role,status,created_at,last_login_at",
    ];

    for (const r of rows) {
      const status = r.isDeactivated ? "deactivated" : "active";
      let roleVal = "";
      if (r.role === "admin") {
        roleVal = "Admin";
      } else {
        const userTeams = teamsByUser.get(r.id) || [];
        roleVal = userTeams
          .map((t) => {
            const base = capitalize(t.role);
            if (t.role.toLowerCase() === "member" && t.subRole) {
              return `${t.name}:${base}(${capitalize(t.subRole)})`;
            }
            return `${t.name}:${base}`;
          })
          .join("; ");
      }

      const safeId = escapeCsv(r.id);
      const safeName = escapeCsv(r.name);
      const safeEmail = escapeCsv(r.email);
      const safeRole = escapeCsv(roleVal);
      const safeStatus = escapeCsv(status);
      const safeCreated = escapeCsv(r.createdAt ? r.createdAt.toISOString() : "");
      const safeLastLogin = escapeCsv(r.lastLoginAt ? r.lastLoginAt.toISOString() : "");

      csvLines.push(
        `${safeId},${safeName},${safeEmail},${safeRole},${safeStatus},${safeCreated},${safeLastLogin}`
      );
    }

    const csvContent = csvLines.join("\n");
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="users-export-${Date.now()}.csv"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

