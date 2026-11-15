import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db, ensureMigrated } from "@/db";
import {
  SESSION_COOKIE_NAME,
  validateSessionToken,
  verifyCsrfToken,
} from "@/lib/auth";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import {
  parseEmployeeCsv,
  runSetupStep4Employees,
  getSetupSnapshotForUser,
  ValidationError,
  assertSetupAdminAccess,
} from "@/lib/setup";
import {
  setupState,
  setupCredentials,
  users,
  orgMembers,
  teamMembers,
  teams,
  projects,
} from "@/db/schema";
import { decryptSetupToken } from "@/lib/setup-token";
import { ForbiddenError } from "@/lib/errors";
import { normalizeEmail } from "@/lib/email";

function escapeCsvCell(val: string): string {
  let cell = val ?? "";
  if (/^[=+\-@\t\r]/.test(cell)) {
    cell = `'${cell}`;
  }
  if (
    cell.includes('"') ||
    cell.includes(",") ||
    cell.includes(";") ||
    cell.includes("\n") ||
    cell.includes("\r")
  ) {
    cell = `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    const [state] = await db
      .select()
      .from(setupState)
      .where(eq(setupState.id, "default"))
      .limit(1);

    if (!state || state.isCompleted) {
      return NextResponse.json(
        { error: "Setup completed or not found" },
        { status: 404 }
      );
    }

    if (!auth.user.isSetupAdmin && auth.user.id !== state.adminUserId) {
      throw new ForbiddenError("Setup admin access required");
    }

    const visibleCols = new Set(
      state.draftData?.employeeVisibleColumns ?? ["team", "projects", "roleNotes"]
    );

    const headerCols: string[] = ["Name", "Email", "Role"];
    if (visibleCols.has("team")) headerCols.push("Teams");
    if (visibleCols.has("projects")) headerCols.push("Projects");
    if (visibleCols.has("roleNotes")) headerCols.push("Role Notes");
    headerCols.push("Temporary password");

    const orgId = state.orgId;
    const employeeRows: Array<{
      id?: string;
      name: string;
      email: string;
      role: string;
      teams: string[];
      projects: string[];
      roleNotes?: string;
      tempPassword?: string;
    }> = [];

    if (orgId) {
      const oMembers = await db
        .select({
          userId: orgMembers.userId,
          role: orgMembers.role,
          name: users.name,
          email: users.email,
          mustChangePassword: users.mustChangePassword,
          isSetupAdmin: users.isSetupAdmin,
        })
        .from(orgMembers)
        .innerJoin(users, eq(orgMembers.userId, users.id))
        .where(eq(orgMembers.orgId, orgId));

      const memberIds = oMembers.map((m) => m.userId);

      const tMembers =
        memberIds.length > 0
          ? await db
              .select({
                userId: teamMembers.userId,
                teamName: teams.name,
                teamId: teams.id,
              })
              .from(teamMembers)
              .innerJoin(teams, eq(teamMembers.teamId, teams.id))
              .where(inArray(teamMembers.userId, memberIds))
          : [];

      const allProjects =
        memberIds.length > 0
          ? await db
              .select({ teamId: projects.teamId, name: projects.name })
              .from(projects)
          : [];

      const creds =
        memberIds.length > 0
          ? await db
              .select()
              .from(setupCredentials)
              .where(inArray(setupCredentials.userId, memberIds))
          : [];
      const credMap = new Map(creds.map((c) => [c.userId, c]));

      for (const m of oMembers) {
        if (m.isSetupAdmin || m.userId === state.adminUserId) continue;

        const userTeams = tMembers.filter((t) => t.userId === m.userId);
        const teamNames = userTeams.map((t) => t.teamName);
        const teamIds = new Set(userTeams.map((t) => t.teamId));
        const userProjects = allProjects
          .filter((p) => teamIds.has(p.teamId))
          .map((p) => p.name);

        const cred = credMap.get(m.userId);
        let passwordVal = "Changed by user";
        if (cred) {
          try {
            passwordVal = decryptSetupToken(cred);
          } catch {
            passwordVal = "Changed by user";
          }
        } else if (m.mustChangePassword) {
          const draftEmp = state.draftData?.employees?.find(
            (e) => e.email.toLowerCase() === m.email.toLowerCase()
          );
          if (draftEmp?.temporaryPassword) {
            passwordVal = draftEmp.temporaryPassword;
          }
        }

        const draftEmp = state.draftData?.employees?.find(
          (e) => e.email.toLowerCase() === m.email.toLowerCase()
        );

        employeeRows.push({
          id: m.userId,
          name: m.name,
          email: m.email,
          role: m.role,
          teams: teamNames,
          projects:
            draftEmp?.projects && draftEmp.projects.length > 0
              ? draftEmp.projects
              : userProjects,
          roleNotes: draftEmp?.roleNotes,
          tempPassword: passwordVal,
        });
      }
    }

    if (state.draftData?.employees) {
      for (const draftEmp of state.draftData.employees) {
        if (
          !employeeRows.some(
            (e) => e.email.toLowerCase() === draftEmp.email.toLowerCase()
          )
        ) {
          employeeRows.push({
            name: draftEmp.name,
            email: draftEmp.email,
            role: draftEmp.role,
            teams: draftEmp.teamSlug ? [draftEmp.teamSlug] : [],
            projects: draftEmp.projects ?? [],
            roleNotes: draftEmp.roleNotes,
            tempPassword: draftEmp.temporaryPassword || "Changed by user",
          });
        }
      }
    }

    const lines: string[] = [];
    lines.push(headerCols.map(escapeCsvCell).join(","));

    for (const emp of employeeRows) {
      const row: string[] = [
        escapeCsvCell(emp.name),
        escapeCsvCell(emp.email),
        escapeCsvCell(emp.role),
      ];
      if (visibleCols.has("team")) {
        row.push(escapeCsvCell(emp.teams.join(";")));
      }
      if (visibleCols.has("projects")) {
        row.push(escapeCsvCell(emp.projects.join(";")));
      }
      if (visibleCols.has("roleNotes")) {
        row.push(escapeCsvCell(emp.roleNotes || ""));
      }
      row.push(escapeCsvCell(emp.tempPassword || "Changed by user"));
      lines.push(row.join(","));
    }

    const csvContent = "\uFEFF" + lines.join("\r\n");
    const dateStr = new Date().toISOString().slice(0, 10);

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="patchwork-members-${dateStr}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureMigrated();
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value || "";
    const auth = token ? await validateSessionToken(token) : null;
    await assertSetupAdminAccess(auth?.user.id ?? null);
    verifyCsrfToken(auth!.session, req.headers.get("x-csrf-token"));

    const contentType = req.headers.get("content-type") || "";
    let csvText = "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (file && typeof (file as Blob).text === "function") {
        csvText = await (file as Blob).text();
      } else {
        csvText = String(form.get("csv") || "");
      }
    } else {
      const body = await req.json();
      csvText = String(body.csv || "");
    }

    const existingUsers = await db.select({ email: users.email }).from(users);
    const existingEmailSet = new Set(existingUsers.map((u) => normalizeEmail(u.email)));
    const snapshotBefore = await getSetupSnapshotForUser(auth!.user.id);
    if (snapshotBefore?.draftData?.admin?.email) {
      existingEmailSet.add(normalizeEmail(snapshotBefore.draftData.admin.email));
    }

    const { employees, parseErrors, skippedRows } = parseEmployeeCsv(csvText, {
      existingEmails: existingEmailSet,
    });

    if (employees.length === 0 && parseErrors.length > 0) {
      const fieldMap: Record<string, string> = {};
      for (const err of parseErrors) {
        fieldMap[`row.${err.row}.${err.field}`] = err.message;
      }
      throw new ValidationError(parseErrors[0].message, fieldMap, parseErrors);
    }

    let provisionedCredentials: Array<{
      name: string;
      email: string;
      role: string;
      teamSlug: string;
      temporaryPassword?: string;
      mustChangePassword: boolean;
    }> = [];
    if (employees.length > 0) {
      const r4 = await runSetupStep4Employees(auth!.user.id, { employees });
      provisionedCredentials = r4.employees;
    }

    const snapshot = await getSetupSnapshotForUser(auth!.user.id);
    return NextResponse.json({
      ...snapshot,
      provisionedCredentials,
      skippedRows,
      importedCount: employees.length,
      parseErrors,
      user: auth!.user,
      csrfToken: auth!.session.csrfToken,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

