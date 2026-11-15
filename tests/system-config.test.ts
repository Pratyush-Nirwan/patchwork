import { describe, it, expect, beforeAll } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db";
import {
  users,
  orgs,
  orgMembers,
  setupState,
  sessions,
  teams,
  teamMembers,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  registerUser,
  loginUser,
  createSession,
  validateSessionToken,
  hashPassword,
} from "@/lib/auth";
import {
  getSystemSetting,
  setSystemSetting,
  resetSystemSetting,
  getDefaultSetting,
} from "@/lib/settings";
import { validateAttachmentConstraints } from "@/lib/attachments";
import { getSearchIndexStatus, rebuildSearchIndex } from "@/lib/search";
import { redactSecrets, generateDiagnosticsBundle } from "@/lib/diagnostics";
import { testForgeConnection } from "@/lib/links";
import { UserRoleBadges } from "@/components/SystemConfigView";
import { NextRequest } from "next/server";
import { GET as getUsersRoute } from "@/app/api/system/users/route";
import { GET as exportUsersRoute } from "@/app/api/system/users/export/route";

describe("System Configuration & Registration Removal", () => {
  let adminUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let testOrg: { id: string; slug: string };

  beforeAll(async () => {
    // Ensure test tables exist and setup state is marked completed
    await db.delete(sessions);
    await db.delete(users).where(sql`email LIKE '%@test-sysconfig.dev%'`);

    // Create test org
    const [existingOrg] = await db.select().from(orgs).limit(1);
    if (existingOrg) {
      testOrg = existingOrg;
    } else {
      const [newOrg] = await db
        .insert(orgs)
        .values({
          name: "Test SysConfig Org",
          slug: "test-sysconfig-org",
        })
        .returning();
      testOrg = newOrg;
    }

    // Create admin user
    const adminPass = await hashPassword("AdminPassword123!");
    const [admin] = await db
      .insert(users)
      .values({
        name: "SysConfig Admin",
        email: "admin@test-sysconfig.dev",
        passwordHash: adminPass,
        isSetupAdmin: true,
      })
      .returning();
    adminUser = admin;

    await db
      .insert(orgMembers)
      .values({
        orgId: testOrg.id,
        userId: admin.id,
        role: "admin",
      })
      .onConflictDoNothing();

    // Create member user
    const memberPass = await hashPassword("MemberPassword123!");
    const [member] = await db
      .insert(users)
      .values({
        name: "SysConfig Member",
        email: "member@test-sysconfig.dev",
        passwordHash: memberPass,
      })
      .returning();
    memberUser = member;

    await db
      .insert(orgMembers)
      .values({
        orgId: testOrg.id,
        userId: member.id,
        role: "member",
      })
      .onConflictDoNothing();

    // Ensure setup state is marked completed
    await db
      .insert(setupState)
      .values({
        id: "default",
        isCompleted: true,
        currentStep: 6,
      })
      .onConflictDoUpdate({
        target: setupState.id,
        set: { isCompleted: true },
      });
  });

  describe("Change 1: Registration Removal", () => {
    it("ensures admin exists and rejects public registration via API once setup is complete", async () => {
      expect(adminUser.id).toBeDefined();
      await expect(
        registerUser({
          name: "Intruder User",
          email: "intruder@test-sysconfig.dev",
          password: "SomePassword123!",
          isPublicRegistration: true,
        })
      ).rejects.toThrow(/Public registration is closed/);
    });
  });

  describe("Change 2: Settings Schema & Persistence", () => {
    it("validates and persists security settings without restart", async () => {
      const defaultSec = getDefaultSetting("security");
      expect(defaultSec.passwordMinLength).toBe(8);

      // Update security settings
      await setSystemSetting("security", {
        passwordMinLength: 10,
        passwordRequireDigit: true,
        passwordRequireMixedCase: true,
        passwordRequireSymbol: false,
        sessionLifetimeMs: 86400000,
        sessionIdleTimeoutMs: 1800000,
        rateLimitMaxFailures: 3,
        rateLimitWindowMs: 600000,
      });

      const updated = await getSystemSetting("security");
      expect(updated.passwordMinLength).toBe(10);
      expect(updated.passwordRequireDigit).toBe(true);
      expect(updated.passwordRequireMixedCase).toBe(true);

      // Reset to default
      await resetSystemSetting("security");
      const reset = await getSystemSetting("security");
      expect(reset.passwordMinLength).toBe(8);
      expect(reset.passwordRequireDigit).toBe(false);
    });

    it("enforces storage limits from system settings", async () => {
      // Set limit to 2MB
      await setSystemSetting("storage", {
        maxAttachmentBytes: 2 * 1024 * 1024,
        allowedMimeTypes: ["text/plain"],
        allowedExtensions: [".txt"],
      });

      // 3MB file must be rejected
      await expect(
        validateAttachmentConstraints({
          filename: "large.txt",
          contentType: "text/plain",
          sizeBytes: 3 * 1024 * 1024,
        })
      ).rejects.toThrow(/exceeds maximum limit/);

      // Disallowed extension must be rejected
      await expect(
        validateAttachmentConstraints({
          filename: "image.png",
          contentType: "image/png",
          sizeBytes: 1024,
        })
      ).rejects.toThrow(/Unsupported file type/);

      // Reset to default
      await resetSystemSetting("storage");
      const resetStorage = await getSystemSetting("storage");
      expect(resetStorage.maxAttachmentBytes).toBe(5 * 1024 * 1024);
    });
  });

  describe("User Management Guards & Actions", () => {
    it("blocks deactivated user from logging in or validating session", async () => {
      // Deactivate member
      await db
        .update(users)
        .set({ isDeactivated: true })
        .where(eq(users.id, memberUser.id));

      await expect(
        loginUser({
          email: memberUser.email,
          password: "MemberPassword123!",
        })
      ).rejects.toThrow(/Account is deactivated/);

      // Create session directly in DB and verify validation rejects
      const session = await createSession(memberUser.id);
      const validated = await validateSessionToken(session.id);
      expect(validated).toBeNull();

      // Reactivate
      await db
        .update(users)
        .set({ isDeactivated: false })
        .where(eq(users.id, memberUser.id));
    });

    it("updates lastLoginAt on successful login", async () => {
      await loginUser({
        email: memberUser.email,
        password: "MemberPassword123!",
      });

      const after = await db
        .select({ lastLoginAt: users.lastLoginAt })
        .from(users)
        .where(eq(users.id, memberUser.id))
        .limit(1);

      expect(after[0]?.lastLoginAt).toBeTruthy();
    });
  });

  describe("Search Index & Diagnostics", () => {
    it("reports search index status and rebuilds safely", async () => {
      const status = await getSearchIndexStatus();
      expect(typeof status.indexedTickets).toBe("number");
      expect(typeof status.indexedComments).toBe("number");
      expect(typeof status.indexedAttachments).toBe("number");
      expect(status.isRebuilding).toBe(false);

      const rebuild = await rebuildSearchIndex();
      expect(typeof rebuild.indexedTickets).toBe("number");
    });

    it("redacts credentials and tokens in error diagnostics", async () => {
      const sampleError =
        "Failed connection to postgres://postgres:mysecretpass@localhost:5432/patchwork with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 and token=super_secret_token";
      const sanitized = redactSecrets(sampleError);
      expect(sanitized).not.toContain("mysecretpass");
      expect(sanitized).not.toContain("super_secret_token");
      expect(sanitized).toContain("[REDACTED]");

      const bundle = await generateDiagnosticsBundle();
      expect(bundle.appVersion).toBeTruthy();
      expect(bundle.nodeVersion).toBeTruthy();
      expect(bundle.database.status).toBe("healthy");
      expect(JSON.stringify(bundle)).not.toContain("mysecretpass");
    });
  });

  describe("Integrations Test", () => {
    it("handles connection test for forge gracefully", async () => {
      const res = await testForgeConnection("github", "invalid_dummy_token");
      expect(res.success).toBe(false);
      expect(res.message).toBeTruthy();
    });
  });

  describe("Role Column Badges, Filters, Sort & CSV Export", () => {
    it("renders single Admin badge for org admin regardless of team roles", () => {
      const html = renderToStaticMarkup(
        React.createElement(UserRoleBadges, {
          role: "admin",
          teams: [
            { id: "t1", name: "Platform", role: "lead" },
            { id: "t2", name: "Security", role: "member" },
          ],
        })
      );
      expect(html).toContain('data-testid="badge-role-admin"');
      expect(html).toContain("Admin");
      expect(html).not.toContain("Platform · Lead");
      expect(html).not.toContain("Security · Member");
    });

    it("renders one badge per team for non-admin with several teams (<=2)", () => {
      const html = renderToStaticMarkup(
        React.createElement(UserRoleBadges, {
          role: "member",
          teams: [
            { id: "t1", name: "Platform", role: "lead" },
            { id: "t2", name: "Payments", role: "member" },
          ],
        })
      );
      expect(html).toContain('data-testid="badge-team-lead"');
      expect(html).toContain("Platform · Lead");
      expect(html).toContain('data-testid="badge-team-member"');
      expect(html).toContain("Payments · Member");
      expect(html).not.toContain("badge-more-teams");
    });

    it("renders +N badge and popover listing all roles when user has >2 teams", () => {
      const html = renderToStaticMarkup(
        React.createElement(UserRoleBadges, {
          role: "member",
          teams: [
            { id: "t1", name: "Platform", role: "lead" },
            { id: "t2", name: "Payments", role: "member" },
            { id: "t3", name: "Mobile", role: "viewer" },
          ],
        })
      );
      expect(html).toContain("Platform · Lead");
      expect(html).toContain("Payments · Member");
      expect(html).toContain('data-testid="badge-more-teams"');
      expect(html).toContain("+1");
      expect(html).toContain('data-testid="teams-popover"');
      expect(html).toContain("Mobile");
      expect(html).toContain("Viewer");
    });

    it("renders 'No team' in muted text for user with no teams", () => {
      const html = renderToStaticMarkup(
        React.createElement(UserRoleBadges, {
          role: "member",
          teams: [],
        })
      );
      expect(html).toContain('data-testid="badge-no-team"');
      expect(html).toContain("No team");
    });

    it("includes visible text labels and accessible contrast tokens on all badges", () => {
      const html = renderToStaticMarkup(
        React.createElement(UserRoleBadges, {
          role: "member",
          teams: [
            { id: "t1", name: "TeamA", role: "lead" },
            { id: "t2", name: "TeamB", role: "viewer" },
          ],
        })
      );
      // Accessible text labels present
      expect(html).toContain("TeamA · Lead");
      expect(html).toContain("TeamB · Viewer");
      // Semantic tokens present
      expect(html).toContain("border");
    });

    it("renders member sub-roles with distinct visual styling and text labels", () => {
      const html = renderToStaticMarkup(
        React.createElement(UserRoleBadges, {
          role: "member",
          teams: [
            { id: "t1", name: "QA", role: "member", subRole: "tester" },
            { id: "t2", name: "Infra", role: "member", subRole: "devops" },
          ],
        })
      );
      expect(html).toContain("QA · Tester");
      expect(html).toContain("Infra · DevOps");
      expect(html).toContain('data-subrole="tester"');
      expect(html).toContain('data-subrole="devops"');
    });

    it("filters and sorts users by role correctly via API", async () => {
      // Create test teams
      const [teamA] = await db
        .insert(teams)
        .values({
          orgId: testOrg.id,
          name: "Team Alpha RoleTest",
          slug: `team-alpha-test-${Date.now()}`,
        })
        .returning();

      const [teamB] = await db
        .insert(teams)
        .values({
          orgId: testOrg.id,
          name: "Team Beta RoleTest",
          slug: `team-beta-test-${Date.now()}`,
        })
        .returning();

      const pass = await hashPassword("UserPass123!");

      // 1. Lead user
      const [leadUser] = await db
        .insert(users)
        .values({
          name: "Role Lead User",
          email: `lead-${Date.now()}@test-sysconfig.dev`,
          passwordHash: pass,
        })
        .returning();
      await db.insert(orgMembers).values({ orgId: testOrg.id, userId: leadUser.id, role: "member" });
      await db.insert(teamMembers).values({ teamId: teamA.id, userId: leadUser.id, role: "lead" });

      // 2. Member user
      const [regMemberUser] = await db
        .insert(users)
        .values({
          name: "Role Member User",
          email: `member-${Date.now()}@test-sysconfig.dev`,
          passwordHash: pass,
        })
        .returning();
      await db.insert(orgMembers).values({ orgId: testOrg.id, userId: regMemberUser.id, role: "member" });
      await db.insert(teamMembers).values({ teamId: teamB.id, userId: regMemberUser.id, role: "member" });

      // 3. Viewer user
      const [viewerUser] = await db
        .insert(users)
        .values({
          name: "Role Viewer User",
          email: `viewer-${Date.now()}@test-sysconfig.dev`,
          passwordHash: pass,
        })
        .returning();
      await db.insert(orgMembers).values({ orgId: testOrg.id, userId: viewerUser.id, role: "member" });
      await db.insert(teamMembers).values({ teamId: teamA.id, userId: viewerUser.id, role: "viewer" });

      // 4. No-team user with formula injection test
      const [noTeamUser] = await db
        .insert(users)
        .values({
          name: "=SUM(1,2)",
          email: `noteam-${Date.now()}@test-sysconfig.dev`,
          passwordHash: pass,
        })
        .returning();
      await db.insert(orgMembers).values({ orgId: testOrg.id, userId: noTeamUser.id, role: "member" });

      // Create session for admin
      const adminSession = await createSession(adminUser.id);
      const reqHeaders = {
        authorization: `Bearer ${adminSession.id}`,
        "x-org-id": testOrg.id,
      };

      // Test role filter: admin
      const adminReq = new NextRequest(`http://localhost:3000/api/system/users?role=admin&orgId=${testOrg.id}`, {
        headers: reqHeaders,
      });
      const adminRes = await getUsersRoute(adminReq);
      const adminData = await adminRes.json();
      expect(adminData.users.every((u: { role: string }) => u.role === "admin")).toBe(true);

      // Test role filter: lead
      const leadReq = new NextRequest(`http://localhost:3000/api/system/users?role=lead&orgId=${testOrg.id}`, {
        headers: reqHeaders,
      });
      const leadRes = await getUsersRoute(leadReq);
      const leadData = await leadRes.json();
      expect(leadData.users.some((u: { id: string }) => u.id === leadUser.id)).toBe(true);
      expect(leadData.users.every((u: { role: string }) => u.role !== "admin")).toBe(true);

      // Test role filter: member
      const memberReq = new NextRequest(`http://localhost:3000/api/system/users?role=member&orgId=${testOrg.id}`, {
        headers: reqHeaders,
      });
      const memberRes = await getUsersRoute(memberReq);
      const memberData = await memberRes.json();
      expect(memberData.users.some((u: { id: string }) => u.id === regMemberUser.id)).toBe(true);

      // Test role filter: viewer
      const viewerReq = new NextRequest(`http://localhost:3000/api/system/users?role=viewer&orgId=${testOrg.id}`, {
        headers: reqHeaders,
      });
      const viewerRes = await getUsersRoute(viewerReq);
      const viewerData = await viewerRes.json();
      expect(viewerData.users.some((u: { id: string }) => u.id === viewerUser.id)).toBe(true);

      // Test role sorting: desc (Admin > Lead > Member > Viewer > No team)
      const sortDescReq = new NextRequest(`http://localhost:3000/api/system/users?sort=role&order=desc&orgId=${testOrg.id}`, {
        headers: reqHeaders,
      });
      const sortDescRes = await getUsersRoute(sortDescReq);
      const sortDescData = await sortDescRes.json();
      const userList = sortDescData.users;
      const adminIdx = userList.findIndex((u: { id: string }) => u.id === adminUser.id);
      const leadIdx = userList.findIndex((u: { id: string }) => u.id === leadUser.id);
      const regMemberIdx = userList.findIndex((u: { id: string }) => u.id === regMemberUser.id);
      const viewerIdx = userList.findIndex((u: { id: string }) => u.id === viewerUser.id);
      const noTeamIdx = userList.findIndex((u: { id: string }) => u.id === noTeamUser.id);

      expect(adminIdx).toBeLessThan(leadIdx);
      expect(leadIdx).toBeLessThan(regMemberIdx);
      expect(regMemberIdx).toBeLessThan(viewerIdx);
      expect(viewerIdx).toBeLessThan(noTeamIdx);

      // Test CSV Export
      const exportReq = new NextRequest(`http://localhost:3000/api/system/users/export?orgId=${testOrg.id}`, {
        headers: reqHeaders,
      });
      const exportRes = await exportUsersRoute(exportReq);
      expect(exportRes.status).toBe(200);
      const csvText = await exportRes.text();

      // Check header
      expect(csvText).toContain("id,name,email,role,status,created_at,last_login_at");

      // Admin has "Admin"
      expect(csvText).toMatch(new RegExp(`"${adminUser.email}","Admin"`));

      // Multi-team / Lead has Team Alpha:Lead
      expect(csvText).toContain("Team Alpha RoleTest:Lead");

      // Member with sub-role has Team Beta:Member(Developer)
      expect(csvText).toContain("Team Beta RoleTest:Member(Developer)");

      // No team user has empty string for role and formula injection is escaped with '
      expect(csvText).toContain("\"'=SUM(1,2)\"");
    });
  });
});
