import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, orgMembers, teamMembers, teams } from "@/db/schema";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import { parseEmployeeCsv, generateSystemPassword } from "@/lib/setup";
import { normalizeEmail } from "@/lib/email";
import { hashPassword } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { orgId } = await requireAdminAuth(req);

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
    const existingEmailSet = new Set(
      existingUsers.map((u) => normalizeEmail(u.email))
    );

    const { employees, parseErrors, skippedRows } = parseEmployeeCsv(csvText, {
      existingEmails: existingEmailSet,
    });

    // Lookup org teams by slug/name
    const orgTeamRows = await db
      .select({ id: teams.id, slug: teams.slug, name: teams.name })
      .from(teams)
      .where(eq(teams.orgId, orgId));

    const teamBySlug = new Map<string, string>();
    for (const t of orgTeamRows) {
      teamBySlug.set(t.slug.toLowerCase(), t.id);
      teamBySlug.set(t.name.toLowerCase(), t.id);
    }

    const importedUsers: Array<{
      id: string;
      name: string;
      email: string;
      role: string;
      temporaryPassword?: string;
    }> = [];

    for (const emp of employees) {
      const normEmail = normalizeEmail(emp.email);
      const tempPass = generateSystemPassword(emp.name);
      const passwordHash = await hashPassword(tempPass);

      const [newUser] = await db
        .insert(users)
        .values({
          name: emp.name,
          email: normEmail,
          passwordHash,
          mustChangePassword: true,
          isSetupAdmin: false,
          isDeactivated: false,
        })
        .returning();

      // Org membership
      const orgRole = emp.role === "admin" ? "admin" : "member";
      await db.insert(orgMembers).values({
        orgId,
        userId: newUser.id,
        role: orgRole,
      });

      // Team membership if specified
      if (emp.teamSlug) {
        const teamId = teamBySlug.get(emp.teamSlug.toLowerCase());
        if (teamId) {
          const teamRole =
            emp.role === "lead" || emp.role === "admin"
              ? "lead"
              : emp.role === "viewer"
              ? "viewer"
              : "member";
          await db
            .insert(teamMembers)
            .values({
              teamId,
              userId: newUser.id,
              role: teamRole,
            })
            .onConflictDoNothing();
        }
      }

      importedUsers.push({
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: orgRole,
        temporaryPassword: tempPass,
      });
    }

    return NextResponse.json({
      success: true,
      importedCount: importedUsers.length,
      importedUsers,
      skippedRows,
      parseErrors,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

