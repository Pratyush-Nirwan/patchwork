import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { PassThrough } from "stream";
import { ensureMigrated, pool } from "@/db";
import {
  registerUser,
  loginUser,
  changeUserPassword,
  validateSessionToken,
  invalidateSession,
  verifyCsrfToken,
} from "@/lib/auth";
import {
  getSetupStatus,
  getSetupSnapshotForUser,
  saveSetupDraft,
  runSetupStep1Admin,
  runSetupStep2Org,
  runSetupStep3Teams,
  runSetupStep4Employees,
  parseEmployeeCsv,
  runSetupStep5Projects,
  runSetupStep6Boards,
  skipSetupStep,
  completeSetupWizard,
  generateSystemPassword,
  generateCryptoPassword,
} from "@/lib/setup";
import { NextRequest } from "next/server";
import { GET as getSetupMembersCsv } from "../src/app/api/setup/csv/route";
import { GET as getSetupCsvTemplate } from "../src/app/api/setup/csv-template/route";
import { GET as validateEmailGet } from "../src/app/api/setup/validate-email/route";
import {
  normalizeEmail,
  isValidEmailFormat,
  EmailTakenError,
} from "@/lib/email";
import { deduplicateExistingEmails } from "@/lib/deduplicate-emails";
import { handleApiError } from "@/lib/http";
import { updateUser } from "@/lib/hierarchy";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import {
  SETUP_TOKEN_ALPHABET,
  SETUP_TOKEN_LENGTH,
  generateSetupTokenString,
  encryptSetupToken,
  decryptSetupToken,
  compareSetupTokenConstantTime,
  provisionSetupTokenInDb,
  clearSetupTokenRateLimits,
} from "@/lib/setup-token";
import { detectInstallState } from "../scripts/setup/state-detect.mjs";
import { runRepair } from "../scripts/setup/repair.mjs";
import { runReset } from "../scripts/setup/reset.mjs";
import { emptyAndRemoveMinioBucket } from "../scripts/setup/minio.mjs";
import {
  applyAnsiToScreenLines,
  createAndStoreAdminToken,
  displayAndConfirmAdminToken,
} from "../scripts/setup/token.mjs";
import { stopServerFromPidFile } from "../scripts/setup/server.mjs";
import { runCliSetup } from "../scripts/setup.mjs";
import {
  createOrg,
  addOrgMember,
  listOrgMembers,
  createTeam,
  addTeamMember,
  listTeamMembers,
  createProject,
  createBoard,
  createColumn,
  updateColumn,
  reorderColumns,
  deleteColumn,
  getBoardWithDetails,
} from "@/lib/hierarchy";
import {
  createTicket,
  updateTicket,
  moveTicket,
  deleteTicket,
  getTicketFullDetails,
} from "@/lib/tickets";
import { addComment } from "@/lib/comments";
import {
  uploadTicketAttachment,
  getAttachmentDownloadUrl,
  deleteAttachment,
} from "@/lib/attachments";
import { addTicketLink, removeTicketLink } from "@/lib/links";
import { searchWorkspace } from "@/lib/search";
import { realtimeHub, type RealtimeEvent } from "@/lib/realtime";

describe("Patchwork Integration Suite (PostgreSQL + MinIO + LISTEN/NOTIFY)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    await pool.query(
      "TRUNCATE setup_token, setup_state, users, sessions, orgs, org_members, teams, team_members, projects, boards, columns, tickets, ticket_comments, ticket_activities, ticket_attachments, ticket_links CASCADE"
    );
  });

  afterAll(async () => {
    await pool.query(
      "TRUNCATE setup_token, setup_state, users, sessions, orgs, org_members, teams, team_members, projects, boards, columns, tickets, ticket_comments, ticket_activities, ticket_attachments, ticket_links CASCADE"
    );
    await realtimeHub.close();
  });

  it("applies migrations cleanly and verifies schema tables exist", async () => {
    const res = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    const tableNames = res.rows.map((r) => r.table_name);
    expect(tableNames).toContain("setup_state");
    expect(tableNames).toContain("setup_token");
    expect(tableNames).toContain("users");
    expect(tableNames).toContain("orgs");
    expect(tableNames).toContain("teams");
    expect(tableNames).toContain("projects");
    expect(tableNames).toContain("boards");
    expect(tableNames).toContain("columns");
    expect(tableNames).toContain("tickets");
    expect(tableNames).toContain("ticket_comments");
    expect(tableNames).toContain("ticket_attachments");
    expect(tableNames).toContain("ticket_links");
  });

  it("validates Admin Setup Token entropy, AES-256-GCM encryption, tamper/wrong-key rejection, constant-time compare, rate limiting, and single-use ciphertext deletion", async () => {
    clearSetupTokenRateLimits();

    // 1. Token format: exactly 32 chars from unambiguous alphabet (no 0/O, 1/l/I) and high entropy
    const samples = new Set<string>();
    const charDistribution = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const tok = generateSetupTokenString();
      expect(tok.length).toBe(SETUP_TOKEN_LENGTH);
      expect(/^[A-HJ-NP-Zabcdefghijkmnopqrstuvwxyz2-9]{32}$/.test(tok)).toBe(true);
      expect(/[0O1lI]/.test(tok)).toBe(false);
      for (const ch of tok) {
        expect(SETUP_TOKEN_ALPHABET.includes(ch)).toBe(true);
        charDistribution.add(ch);
      }
      samples.add(tok);
    }
    expect(samples.size).toBe(30);
    expect(charDistribution.size).toBeGreaterThan(35);

    // 2. AES-256-GCM encryption: IV (12 bytes) and authTag (16 bytes) present; tampered ciphertext or wrong key fails decryption
    const testKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const wrongKey = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    const plain = generateSetupTokenString();
    const encrypted = encryptSetupToken(plain, testKey);

    expect(encrypted.ciphertext).not.toContain(plain);
    expect(Buffer.from(encrypted.iv, "base64").length).toBe(12);
    expect(Buffer.from(encrypted.authTag, "base64").length).toBe(16);
    expect(decryptSetupToken(encrypted, testKey)).toBe(plain);

    // Wrong key fails decryption
    expect(() => decryptSetupToken(encrypted, wrongKey)).toThrow();

    // Tampered ciphertext fails decryption
    const rawCipher = Buffer.from(encrypted.ciphertext, "base64");
    rawCipher[0] ^= 0xff;
    expect(() =>
      decryptSetupToken(
        { ...encrypted, ciphertext: rawCipher.toString("base64") },
        testKey
      )
    ).toThrow();

    // Tampered authTag fails decryption
    const rawTag = Buffer.from(encrypted.authTag, "base64");
    rawTag[0] ^= 0xff;
    expect(() =>
      decryptSetupToken(
        { ...encrypted, authTag: rawTag.toString("base64") },
        testKey
      )
    ).toThrow();

    // 3. Constant-time comparison helper
    expect(compareSetupTokenConstantTime(plain, plain)).toBe(true);
    expect(compareSetupTokenConstantTime(plain, "wrong")).toBe(false);
    expect(
      compareSetupTokenConstantTime(
        plain,
        plain.slice(0, 31) + (plain[31] === "A" ? "B" : "A")
      )
    ).toBe(false);

    // 4. Provision token in DB and verify plaintext is absent from setup_token table
    process.env.TOKEN_ENCRYPTION_KEY = testKey;
    const activeToken = await provisionSetupTokenInDb(testKey);
    const dbTokenRow = await pool.query(
      "SELECT ciphertext, iv, auth_tag, consumed_at FROM setup_token WHERE id = 'default'"
    );
    expect(dbTokenRow.rowCount).toBe(1);
    expect(dbTokenRow.rows[0].ciphertext).toBeTruthy();
    expect(dbTokenRow.rows[0].ciphertext).not.toBe(activeToken);
    expect(dbTokenRow.rows[0].iv).toBeTruthy();
    expect(dbTokenRow.rows[0].auth_tag).toBeTruthy();
    expect(dbTokenRow.rows[0].consumed_at).toBeNull();

    // 5. Wizard Step 1 rejects missing token and wrong token
    await expect(
      runSetupStep1Admin(null, {
        name: "Setup Admin",
        email: "setup-admin@patchwork.dev",
        password: "AdminSetupPassword123!",
        setupToken: "",
        clientIp: "10.0.0.50",
      })
    ).rejects.toThrow(/Setup step 1 verification failed/i);

    await expect(
      runSetupStep1Admin(null, {
        name: "Setup Admin",
        email: "setup-admin@patchwork.dev",
        password: "AdminSetupPassword123!",
        setupToken: "WrongToken23456789ABCDEFGHJKLMNP",
        clientIp: "10.0.0.50",
      })
    ).rejects.toThrow(/Setup step 1 verification failed/i);

    // Wrong encryption key in env blocks Step 1 with generic error
    process.env.TOKEN_ENCRYPTION_KEY = wrongKey;
    await expect(
      runSetupStep1Admin(null, {
        name: "Setup Admin",
        email: "setup-admin@patchwork.dev",
        password: "AdminSetupPassword123!",
        setupToken: activeToken,
        clientIp: "10.0.0.50",
      })
    ).rejects.toThrow(/Setup step 1 verification failed/i);
    process.env.TOKEN_ENCRYPTION_KEY = testKey;

    // 6. Rate limiting triggers after 5 failed attempts from an IP within 15 minutes
    const rateLimitedIp = "10.0.0.99";
    for (let attempt = 1; attempt <= 5; attempt++) {
      await expect(
        runSetupStep1Admin(null, {
          name: "Brute Force",
          email: "brute@patchwork.dev",
          password: "AdminSetupPassword123!",
          setupToken: `BadAttemptTokenNumber${attempt}ABCDEFGH`,
          clientIp: rateLimitedIp,
        })
      ).rejects.toThrow(/Setup step 1 verification failed/i);
    }

    // 6th attempt from rateLimitedIp is blocked by rate limiter even with valid token
    await expect(
      runSetupStep1Admin(null, {
        name: "Brute Force",
        email: "brute@patchwork.dev",
        password: "AdminSetupPassword123!",
        setupToken: activeToken,
        clientIp: rateLimitedIp,
      })
    ).rejects.toThrow(/try again later/i);

    clearSetupTokenRateLimits();
  });

  it("executes first-run setup wizard: step 1 admin, closed registration, autosave & resume, idempotent steps, CSV import & forced password change, RBAC, and lock on completion", async () => {
    clearSetupTokenRateLimits();
    const validSetupToken = await provisionSetupTokenInDb();

    // 1. Fresh install state is incomplete
    const initialStatus = await getSetupStatus();
    expect(initialStatus.isCompleted).toBe(false);
    expect(initialStatus.hasAdmin).toBe(false);
    expect(initialStatus.currentStep).toBe(1);

    // 2. Step 1: First registered user becomes setup admin and consumes the single-use setup token
    const step1 = await runSetupStep1Admin(null, {
      name: "Setup Admin",
      email: "setup-admin@patchwork.dev",
      password: "AdminSetupPassword123!",
      setupToken: validSetupToken,
    });
    expect(step1.auth).toBeDefined();
    const adminId = step1.auth!.user.id;
    expect(step1.auth!.user.isSetupAdmin).toBe(true);
    expect(step1.state.currentStep).toBe(2);
    expect(step1.state.completedSteps).toContain(1);

    // Verify token ciphertext, IV, and auth_tag are deleted from setup_token and consumed_at is set
    const consumedRow = await pool.query(
      "SELECT ciphertext, iv, auth_tag, consumed_at FROM setup_token WHERE id = 'default'"
    );
    expect(consumedRow.rows[0].consumed_at).toBeTruthy();
    expect(consumedRow.rows[0].ciphertext).toBeNull();
    expect(consumedRow.rows[0].iv).toBeNull();
    expect(consumedRow.rows[0].auth_tag).toBeNull();

    // Submitting the consumed token again is rejected
    await expect(
      runSetupStep1Admin(null, {
        name: "Second Attempt",
        email: "second@patchwork.dev",
        password: "AdminSetupPassword123!",
        setupToken: validSetupToken,
      })
    ).rejects.toThrow();

    // 3. Public registration is closed to everyone else during setup
    await expect(
      registerUser({
        email: "intruder@patchwork.dev",
        password: "IntruderPassword123!",
        name: "Intruder",
      })
    ).rejects.toThrow(/Registration is closed/i);

    // Re-running Step 1 unauthenticated is also blocked
    await expect(
      runSetupStep1Admin(null, {
        name: "Intruder",
        email: "intruder@patchwork.dev",
        password: "IntruderPassword123!",
      })
    ).rejects.toThrow(/Registration is closed/i);

    // Re-running Step 1 authenticated as admin updates admin in-place without duplicating
    await runSetupStep1Admin(adminId, {
      name: "Setup Admin Updated",
      email: "setup-admin@patchwork.dev",
    });
    const userCountAfterStep1Rerun = await pool.query("SELECT count(*)::int AS cnt FROM users");
    expect(userCountAfterStep1Rerun.rows[0].cnt).toBe(1);

    // 4. Autosave & Resume (after closing tab, logging out, or server restart)
    await saveSetupDraft(adminId, {
      currentStep: 2,
      draftData: {
        org: {
          name: "Drafted Aerospace",
          slug: "drafted-aerospace",
          description: "Saved before closing tab",
        },
      },
    });

    // When logged out (actorId = null), snapshot requires auth
    const loggedOutSnap = await getSetupSnapshotForUser(null);
    expect(loggedOutSnap.requiresAuth).toBe(true);
    expect(loggedOutSnap.currentStep).toBe(2);

    // When admin logs back in, exact step and draft data are restored
    const resumedSnap = await getSetupSnapshotForUser(adminId);
    expect(resumedSnap.requiresAuth).toBe(false);
    expect(resumedSnap.currentStep).toBe(2);
    expect(resumedSnap.draftData.org?.name).toBe("Drafted Aerospace");
    expect(resumedSnap.draftData.org?.description).toBe("Saved before closing tab");

    // 5. Step 2: Organization (idempotent on re-run)
    const step2a = await runSetupStep2Org(adminId, {
      name: "Drafted Aerospace",
      slug: "drafted-aerospace",
      description: "Initial org description",
    });
    const step2b = await runSetupStep2Org(adminId, {
      name: "Orbital Dynamics",
      slug: "orbital-dynamics",
      description: "Updated org description",
    });
    expect(step2b.org.id).toBe(step2a.org.id);
    const orgCount = await pool.query("SELECT count(*)::int AS cnt FROM orgs");
    expect(orgCount.rows[0].cnt).toBe(1);

    // 6. Step 3: Teams (idempotent on re-run)
    await runSetupStep3Teams(adminId, {
      teams: [
        {
          name: "Propulsion",
          slug: "propulsion",
          description: "Rocket engines",
          leadEmail: "csv-lead@patchwork.dev",
        },
        {
          name: "Avionics",
          slug: "avionics",
          description: "Guidance systems",
        },
      ],
    });
    // Re-run Step 3 with updated description -> updates existing teams, never duplicates
    const step3b = await runSetupStep3Teams(adminId, {
      teams: [
        {
          name: "Propulsion Systems",
          slug: "propulsion",
          description: "Liquid rocket engines",
          leadEmail: "csv-lead@patchwork.dev",
        },
        {
          name: "Avionics",
          slug: "avionics",
          description: "Flight computers",
        },
      ],
    });
    expect(step3b.teams.length).toBe(2);
    const teamCount = await pool.query("SELECT count(*)::int AS cnt FROM teams");
    expect(teamCount.rows[0].cnt).toBe(2);

    // 7. Step 4: CSV Import validation reports invalid rows without dropping them silently
    const badCsv = [
      "name,email,role,team,password",
      "Valid User,valid@patchwork.dev,member,propulsion,TempPass123!",
      ",missing-name@patchwork.dev,invalid_role,propulsion,short",
    ].join("\n");
    const parsedBad = parseEmployeeCsv(badCsv);
    expect(parsedBad.parseErrors.length).toBeGreaterThanOrEqual(3);
    expect(parsedBad.parseErrors.some((e) => e.row === 3 && e.field === "name")).toBe(true);
    expect(parsedBad.parseErrors.some((e) => e.row === 3 && e.field === "role")).toBe(true);
    expect(
      parsedBad.parseErrors.some((e) => e.row === 3 && e.field === "temporaryPassword")
    ).toBe(true);

    // Valid CSV import creates employees with forced password change (mustChangePassword = true)
    const validCsv = [
      "name,email,role,team,password",
      "CSV Lead,csv-lead@patchwork.dev,team lead,propulsion,TempLead123!",
      "CSV Member,csv-member@patchwork.dev,member,avionics,",
    ].join("\n");
    const parsedValid = parseEmployeeCsv(validCsv);
    expect(parsedValid.parseErrors.length).toBe(0);

    const step4a = await runSetupStep4Employees(adminId, {
      employees: parsedValid.employees,
    });
    expect(step4a.employees.length).toBe(2);
    expect(step4a.employees[0].mustChangePassword).toBe(true);
    expect(step4a.employees[1].temporaryPassword).toBeTruthy();

    // Verify system password generator and crypto password generator (Change 3)
    const priyaPass = generateSystemPassword("Priya Sharma");
    expect(priyaPass).toMatch(/^PriyaS@[0-9]{4}$/);
    expect(priyaPass.length).toBeGreaterThanOrEqual(8);
    const accentedPass = generateSystemPassword("  José   Martínez  ");
    expect(accentedPass).toMatch(/^JoseM@[0-9]{4}$/);
    const singlePass = generateSystemPassword("Cher");
    expect(singlePass).toMatch(/^CherR@[0-9]{4}$/);
    const cryptoPass = generateCryptoPassword(16);
    expect(cryptoPass.length).toBe(16);

    // Verify credentials are encrypted at rest in setup_credentials table
    const credRowsBefore = await pool.query(
      "SELECT user_id, ciphertext, iv, auth_tag FROM setup_credentials"
    );
    expect(credRowsBefore.rows.length).toBe(2);
    for (const r of credRowsBefore.rows) {
      expect(r.ciphertext).toBeTruthy();
      expect(r.iv).toBeTruthy();
      expect(r.auth_tag).toBeTruthy();
    }

    // Re-running Step 4 with same employees is idempotent
    await runSetupStep4Employees(adminId, {
      employees: parsedValid.employees,
    });

    // Non-admin employee cannot access /setup (RBAC check)
    const csvLeadLogin = await loginUser({
      email: "csv-lead@patchwork.dev",
      password: "TempLead123!",
    });
    expect(csvLeadLogin.user.mustChangePassword).toBe(true);
    await expect(getSetupSnapshotForUser(csvLeadLogin.user.id)).rejects.toThrow(
      /Only the organization administrator/i
    );

    // Forced password change on first login clears mustChangePassword AND deletes user's setup_credentials row (Change 3)
    const afterPassChange = await changeUserPassword(csvLeadLogin.user.id, {
      currentPassword: "TempLead123!",
      newPassword: "NewPermanentLeadPass123!",
    });
    expect(afterPassChange.mustChangePassword).toBe(false);

    const credRowsAfterChange = await pool.query(
      "SELECT user_id FROM setup_credentials WHERE user_id = $1",
      [csvLeadLogin.user.id]
    );
    expect(credRowsAfterChange.rows.length).toBe(0);

    // 7b. Configurable column visibility in setup draft (Change 4)
    await saveSetupDraft(adminId, {
      draftData: {
        employeeVisibleColumns: ["projects"],
      },
    });
    const snapshotWithCols = await getSetupSnapshotForUser(adminId);
    expect(snapshotWithCols.draftData?.employeeVisibleColumns).toEqual(["projects"]);

    // CSV template respects visible columns (Change 4)
    const templateRes = await getSetupCsvTemplate();
    expect(templateRes.status).toBe(200);
    const templateBody = await templateRes.text();
    expect(templateBody).toContain("name,email,role,projects,password");
    expect(templateBody).not.toContain("team,");
    expect(templateBody).not.toContain("role_notes,");

    // CSV download before completion (Change 5)
    const adminSessionToken = step1.auth!.session.id;
    const csvReq = new NextRequest("http://localhost:3000/api/setup/csv", {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${adminSessionToken}`,
      },
    });
    const csvRes = await getSetupMembersCsv(csvReq);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("Content-Type")).toContain("text/csv");
    expect(csvRes.headers.get("Content-Disposition")).toContain("patchwork-members-");
    expect(csvRes.headers.get("Cache-Control")).toBe("no-store");

    const csvBuffer = Buffer.from(await csvRes.arrayBuffer());
    // Must begin with UTF-8 BOM (0xEF, 0xBB, 0xBF)
    expect(csvBuffer[0]).toBe(0xef);
    expect(csvBuffer[1]).toBe(0xbb);
    expect(csvBuffer[2]).toBe(0xbf);
    const csvText = csvBuffer.toString("utf8");
    expect(csvText.startsWith("\uFEFF")).toBe(true);
    // Header excludes hidden 'team' and 'roleNotes', includes 'Projects'
    expect(csvText).toContain("Name,Email,Role,Projects,Temporary password");
    expect(csvText).not.toContain("Teams");
    expect(csvText).not.toContain("Role Notes");
    // CSV Lead changed password -> "Changed by user"
    expect(csvText).toContain("CSV Lead,csv-lead@patchwork.dev,member,,Changed by user");
    // CSV Member still has their temporary system password
    expect(csvText).toContain("CSV Member,csv-member@patchwork.dev,member,");
    expect(csvText).not.toContain("CSV Member,csv-member@patchwork.dev,member,,Changed by user");

    // Non-admin request to CSV download is forbidden
    const nonAdminCsvReq = new NextRequest("http://localhost:3000/api/setup/csv", {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${csvLeadLogin.session.id}`,
      },
    });
    const nonAdminCsvRes = await getSetupMembersCsv(nonAdminCsvReq);
    expect(nonAdminCsvRes.status).toBe(403);

    // 8. Optional steps can be skipped and completed/edited later
    const skipped5 = await skipSetupStep(adminId, 5);
    expect(skipped5.skippedSteps).toContain(5);
    expect(skipped5.currentStep).toBe(6);

    // Go back and run Step 5 (Projects) idempotently
    await runSetupStep5Projects(adminId, {
      projects: [
        {
          teamSlug: "propulsion",
          name: "Raptor Engine",
          key: "RAPT",
          description: "Full-flow staged combustion",
        },
      ],
    });
    await runSetupStep5Projects(adminId, {
      projects: [
        {
          teamSlug: "propulsion",
          name: "Raptor Engine v2",
          key: "RAPT",
          description: "Updated description",
        },
      ],
    });
    const projCount = await pool.query("SELECT count(*)::int AS cnt FROM projects");
    expect(projCount.rows[0].cnt).toBe(1);

    // 9. Step 6: Boards & editable columns (idempotent)
    await runSetupStep6Boards(adminId, {
      boards: [
        {
          projectKey: "RAPT",
          name: "Test Stand Sprint",
          columns: [
            { name: "Backlog", wipLimit: null },
            { name: "Hotfire", wipLimit: 2 },
            { name: "Done", wipLimit: null },
          ],
        },
      ],
    });
    const step6b = await runSetupStep6Boards(adminId, {
      boards: [
        {
          projectKey: "RAPT",
          name: "Test Stand Sprint",
          columns: [
            { name: "Backlog", wipLimit: null },
            { name: "Hotfire", wipLimit: 3 },
            { name: "Done", wipLimit: null },
          ],
        },
      ],
    });
    expect(step6b.boards.length).toBe(1);
    expect(step6b.boards[0].columns.length).toBe(3);

    // 10. Step 7: Complete setup and verify /setup is locked
    const finalResult = await completeSetupWizard(adminId);
    expect(finalResult.state.isCompleted).toBe(true);
    expect(finalResult.summary.org?.slug).toBe("orbital-dynamics");
    expect(finalResult.summary.teams.length).toBe(2);
    expect(finalResult.summary.projects.length).toBe(1);
    expect(finalResult.summary.boards.length).toBe(1);

    // After setup completes, all setup_credentials rows are purged (Change 3 & 5)
    const credRowsFinal = await pool.query("SELECT count(*)::int AS cnt FROM setup_credentials");
    expect(credRowsFinal.rows[0].cnt).toBe(0);

    // CSV endpoint returns 404 after setup completes (Change 5)
    const afterCompleteCsvRes = await getSetupMembersCsv(csvReq);
    expect(afterCompleteCsvRes.status).toBe(404);

    await expect(
      saveSetupDraft(adminId, { currentStep: 2 })
    ).rejects.toThrow(/completed and locked/i);
    await expect(
      runSetupStep2Org(adminId, { name: "Locked Org" })
    ).rejects.toThrow(/completed and locked/i);
  });

  it("handles auth lifecycle: register, login, wrong password rejection, CSRF, session expiry, and logout", async () => {
    const reg = await registerUser({
      email: "auth-admin@patchwork.dev",
      password: "CorrectHorseBatteryStaple!",
      name: "Auth Admin",
    });
    expect(reg.user.email).toBe("auth-admin@patchwork.dev");
    expect(reg.session.id).toBeTruthy();

    // Wrong password rejected
    await expect(
      loginUser({
        email: "auth-admin@patchwork.dev",
        password: "WrongPassword123!",
      })
    ).rejects.toThrow(/Invalid email or password/);

    // Valid login succeeds
    const loggedIn = await loginUser({
      email: "auth-admin@patchwork.dev",
      password: "CorrectHorseBatteryStaple!",
    });
    expect(loggedIn.user.id).toBe(reg.user.id);

    // CSRF validation
    expect(() =>
      verifyCsrfToken(loggedIn.session, loggedIn.session.csrfToken)
    ).not.toThrow();
    expect(() => verifyCsrfToken(loggedIn.session, "bad-csrf")).toThrow(
      /Invalid or missing CSRF token/
    );

    // Session expiry enforcement
    const shortSession = await loginUser({
      email: "auth-admin@patchwork.dev",
      password: "CorrectHorseBatteryStaple!",
      ttlMs: -5000, // already expired
    });
    const expiredLookup = await validateSessionToken(shortSession.session.id);
    expect(expiredLookup).toBeNull();

    // Logout invalidates session
    await invalidateSession(loggedIn.session.id);
    const afterLogout = await validateSessionToken(loggedIn.session.id);
    expect(afterLogout).toBeNull();
  });

  it("enforces RBAC for admin, team lead, member, viewer, and outsiders across hierarchy & tickets", async () => {
    const admin = (
      await registerUser({
        email: "org-admin@patchwork.dev",
        password: "Password123!",
        name: "Org Admin",
      })
    ).user;
    const lead = (
      await registerUser({
        email: "team-lead@patchwork.dev",
        password: "Password123!",
        name: "Team Lead",
      })
    ).user;
    const member = (
      await registerUser({
        email: "team-member@patchwork.dev",
        password: "Password123!",
        name: "Team Member",
      })
    ).user;
    const viewer = (
      await registerUser({
        email: "team-viewer@patchwork.dev",
        password: "Password123!",
        name: "Team Viewer",
      })
    ).user;
    const outsider = (
      await registerUser({
        email: "outsider@patchwork.dev",
        password: "Password123!",
        name: "Outsider",
      })
    ).user;

    const org = await createOrg(admin.id, { name: "Acme Engineering" });
    const team = await createTeam(admin.id, org.id, {
      name: "Platform Core",
    });

    // Non-admin cannot create team in org
    await expect(
      createTeam(lead.id, org.id, { name: "Unauthorized Team" })
    ).rejects.toThrow(/admin/i);

    // Admin adds lead, member, viewer (both existing users and direct account creation)
    await addTeamMember(admin.id, team.id, {
      userId: lead.id,
      role: "lead",
    });
    await addTeamMember(lead.id, team.id, {
      userId: member.id,
      role: "member",
    });
    await addTeamMember(lead.id, team.id, {
      userId: viewer.id,
      role: "viewer",
    });

    // Direct account creation in Team/Org modal:
    // 1. Org Admin directly provisions an admin, lead, member, and viewer with Name, Email, Password, Role
    await addTeamMember(admin.id, team.id, {
      name: "Provisioned Co-Admin",
      email: "provisioned-admin@patchwork.dev",
      password: "Password123!",
      role: "admin",
    });
    const coAdminLogin = await loginUser({
      email: "provisioned-admin@patchwork.dev",
      password: "Password123!",
    });
    expect(coAdminLogin.user.name).toBe("Provisioned Co-Admin");

    await addOrgMember(admin.id, org.id, {
      name: "Direct Org Member",
      email: "direct-org-member@patchwork.dev",
      password: "Password123!",
      role: "member",
    });
    const orgMemberRows = await listOrgMembers(admin.id, org.id);
    expect(
      orgMemberRows.some(
        (m) => m.email === "provisioned-admin@patchwork.dev" && m.role === "admin"
      )
    ).toBe(true);

    // 2. Team Lead directly provisions lead, member, and viewer accounts in their team
    await addTeamMember(lead.id, team.id, {
      name: "Provisioned Lead",
      email: "provisioned-lead@patchwork.dev",
      password: "Password123!",
      role: "lead",
    });
    await addTeamMember(lead.id, team.id, {
      name: "Provisioned Member",
      email: "provisioned-member@patchwork.dev",
      password: "Password123!",
      role: "member",
    });
    await addTeamMember(lead.id, team.id, {
      name: "Provisioned Viewer",
      email: "provisioned-viewer@patchwork.dev",
      password: "Password123!",
      role: "viewer",
    });

    const provMemberLogin = await loginUser({
      email: "provisioned-member@patchwork.dev",
      password: "Password123!",
    });
    expect(provMemberLogin.user.name).toBe("Provisioned Member");

    // 3. Team Lead CANNOT create or assign an 'admin' account
    await expect(
      addTeamMember(lead.id, team.id, {
        name: "Unauthorized Admin",
        email: "unauth-admin@patchwork.dev",
        password: "Password123!",
        role: "admin",
      })
    ).rejects.toThrow(/Only organization admins/i);

    // 4. Member and Viewer CANNOT create or assign accounts
    await expect(
      addTeamMember(member.id, team.id, {
        name: "Illegal Account",
        email: "illegal@patchwork.dev",
        password: "Password123!",
        role: "viewer",
      })
    ).rejects.toThrow(/Requires at least 'lead'/);
    await expect(
      addTeamMember(viewer.id, team.id, {
        email: outsider.email,
        role: "viewer",
      })
    ).rejects.toThrow(/Requires at least 'lead'/);

    const roster = await listTeamMembers(viewer.id, team.id);
    expect(
      roster.find((r) => r.email === "provisioned-admin@patchwork.dev")?.role
    ).toBe("admin");
    expect(
      roster.find((r) => r.email === "provisioned-lead@patchwork.dev")?.role
    ).toBe("lead");
    expect(
      roster.find((r) => r.email === "provisioned-member@patchwork.dev")?.role
    ).toBe("member");
    expect(
      roster.find((r) => r.email === "provisioned-viewer@patchwork.dev")?.role
    ).toBe("viewer");

    // Member and viewer cannot create project (requires lead or admin)
    await expect(
      createProject(member.id, team.id, { name: "Forbidden Proj", key: "FORB" })
    ).rejects.toThrow(/Requires at least 'lead'/);
    await expect(
      createProject(viewer.id, team.id, { name: "Viewer Proj", key: "VIEW" })
    ).rejects.toThrow(/Requires at least 'lead'/);

    // Team lead CAN create project and board
    const project = await createProject(lead.id, team.id, {
      name: "Core Runtime",
      key: "CORE",
    });
    const board = await createBoard(lead.id, project.id, {
      name: "Sprint 42",
    });

    // Member cannot create or delete columns (requires lead)
    await expect(
      createColumn(member.id, board.id, { name: "Blocked" })
    ).rejects.toThrow(/Requires at least 'lead'/);

    // Lead CAN create, rename, reorder, and delete columns
    const customCol = await createColumn(lead.id, board.id, {
      name: "QA Staging",
      wipLimit: 4,
    });
    const renamedCol = await updateColumn(lead.id, customCol.id, {
      name: "Staging Verification",
      wipLimit: 2,
    });
    expect(renamedCol.name).toBe("Staging Verification");
    expect(renamedCol.wipLimit).toBe(2);

    // Member CAN create and move tickets
    const ticket = await createTicket(member.id, board.id, {
      title: "Optimize connection pooler",
      description: "Ensure low latency under **high concurrency**.",
      priority: "high",
      labels: ["database", "perf"],
    });
    expect(ticket.key).toBe("CORE-1");

    // Viewer can read board and ticket details, but CANNOT create/move/comment
    const viewerBoard = await getBoardWithDetails(viewer.id, board.id);
    expect(viewerBoard.tickets.length).toBe(1);

    await expect(
      createTicket(viewer.id, board.id, { title: "Viewer Ticket" })
    ).rejects.toThrow(/Requires at least 'member'/);
    await expect(
      moveTicket(viewer.id, ticket.id, { targetColumnId: customCol.id })
    ).rejects.toThrow(/Requires at least 'member'/);
    await expect(
      addComment(viewer.id, ticket.id, { body: "Viewer comment" })
    ).rejects.toThrow(/Requires at least 'member'/);

    // Column reordering permissions (Change 1):
    // Member and Viewer CANNOT reorder columns (server rejects with 403 ForbiddenError)
    const boardColIds = viewerBoard.columns.map((c) => c.id);
    await expect(
      reorderColumns(member.id, board.id, [boardColIds[1], boardColIds[0], ...boardColIds.slice(2)])
    ).rejects.toThrow(/Requires at least 'lead'/i);
    await expect(
      reorderColumns(viewer.id, board.id, [boardColIds[1], boardColIds[0], ...boardColIds.slice(2)])
    ).rejects.toThrow(/Requires at least 'lead'/i);

    // Lead and Admin CAN reorder columns
    await expect(
      reorderColumns(lead.id, board.id, [boardColIds[1], boardColIds[0], ...boardColIds.slice(2)])
    ).resolves.toBeDefined();
    await expect(
      reorderColumns(admin.id, board.id, boardColIds)
    ).resolves.toBeDefined();

    // Outsider cannot even view the board
    await expect(getBoardWithDetails(outsider.id, board.id)).rejects.toThrow(
      /access/i
    );

    // Delete temporary custom column
    await deleteColumn(lead.id, customCol.id);
  });

  it("enforces sequential workflow transitions on ticket movement and allows admin/lead override", async () => {
    const admin = (
      await registerUser({
        email: `wf-admin-${Date.now()}@example.org`,
        password: "Password123!",
        name: "Workflow Admin",
      })
    ).user;
    const org = await createOrg(admin.id, { name: "Workflow Org" });
    const team = await createTeam(admin.id, org.id, { name: "Workflow Team" });
    const member = (
      await registerUser({
        email: `wf-member-${Date.now()}@example.org`,
        password: "Password123!",
        name: "Workflow Member",
      })
    ).user;
    const lead = (
      await registerUser({
        email: `wf-lead-${Date.now()}@example.org`,
        password: "Password123!",
        name: "Workflow Lead",
      })
    ).user;
    await addTeamMember(admin.id, team.id, { userId: member.id, role: "member" });
    await addTeamMember(admin.id, team.id, { userId: lead.id, role: "lead" });

    const project = await createProject(admin.id, team.id, {
      name: "Workflow Project",
      key: "FLOW",
    });
    const board = await createBoard(admin.id, project.id, {
      name: "Flow Board",
      columns: [
        { name: "Backlog" },
        { name: "New" },
        { name: "In Progress" },
        { name: "In Review" },
        { name: "Done" },
      ],
    });

    const boardDetails = await getBoardWithDetails(admin.id, board.id);
    const cols = boardDetails.columns;
    expect(cols.length).toBe(5);

    const ticket = await createTicket(member.id, board.id, {
      title: "Task 1",
      columnId: cols[0].id,
    });
    expect(ticket.columnId).toBe(cols[0].id);

    // 1. Member cannot jump forward directly from Backlog (0) to In Progress (2) or Done (4)
    await expect(
      moveTicket(member.id, ticket.id, { targetColumnId: cols[2].id })
    ).rejects.toThrow(/cannot advance directly/i);

    await expect(
      moveTicket(member.id, ticket.id, { targetColumnId: cols[4].id })
    ).rejects.toThrow(/cannot advance directly/i);

    // 2. Member CAN advance sequentially to immediate next column: Backlog (0) -> New (1)
    const movedToNew = await moveTicket(member.id, ticket.id, { targetColumnId: cols[1].id });
    expect(movedToNew.columnId).toBe(cols[1].id);

    // 3. Member CAN reorder within same column
    const reorderedInNew = await moveTicket(member.id, ticket.id, {
      targetColumnId: cols[1].id,
      targetPosition: 0,
    });
    expect(reorderedInNew.columnId).toBe(cols[1].id);

    // 4. Member CAN advance sequentially: New (1) -> In Progress (2)
    const movedToProg = await moveTicket(member.id, ticket.id, { targetColumnId: cols[2].id });
    expect(movedToProg.columnId).toBe(cols[2].id);

    // 5. Member CAN move backward for rework: In Progress (2) -> Backlog (0)
    const movedBack = await moveTicket(member.id, ticket.id, { targetColumnId: cols[0].id });
    expect(movedBack.columnId).toBe(cols[0].id);

    // 6. Lead CAN jump forward directly across columns (triage bypass)
    const leadMoved = await moveTicket(lead.id, ticket.id, { targetColumnId: cols[4].id });
    expect(leadMoved.columnId).toBe(cols[4].id);

    // 7. Admin CAN jump across any column
    const adminMoved = await moveTicket(admin.id, ticket.id, { targetColumnId: cols[1].id });
    expect(adminMoved.columnId).toBe(cols[1].id);
  });

  it("persists and reorders tickets across and within columns and records activity & comments", async () => {
    const admin = (
      await registerUser({
        email: "kanban@patchwork.dev",
        password: "Password123!",
        name: "Kanban Engineer",
      })
    ).user;
    const org = await createOrg(admin.id, { name: "Kanban Org" });
    const team = await createTeam(admin.id, org.id, { name: "Infra Team" });
    const project = await createProject(admin.id, team.id, {
      name: "Storage Engine",
      key: "STOR",
    });
    const board = await createBoard(admin.id, project.id, {
      name: "Storage Board",
      columns: [
        { name: "Todo", wipLimit: null },
        { name: "In Progress", wipLimit: 3 },
        { name: "Done", wipLimit: null },
      ],
    });

    const [todoCol, inProgCol, doneCol] = board.columns;

    // Reorder columns and restore
    const reordered = await reorderColumns(admin.id, board.id, [
      todoCol.id,
      doneCol.id,
      inProgCol.id,
    ]);
    expect(reordered.map((c) => c.name)).toEqual([
      "Todo",
      "Done",
      "In Progress",
    ]);
    await reorderColumns(admin.id, board.id, [
      todoCol.id,
      inProgCol.id,
      doneCol.id,
    ]);

    const t1 = await createTicket(admin.id, board.id, {
      columnId: todoCol.id,
      title: "Ticket One",
    });
    const t2 = await createTicket(admin.id, board.id, {
      columnId: todoCol.id,
      title: "Ticket Two",
    });
    const t3 = await createTicket(admin.id, board.id, {
      columnId: todoCol.id,
      title: "Ticket Three",
    });

    expect(t1.position).toBe(0);
    expect(t2.position).toBe(1);
    expect(t3.position).toBe(2);

    // Reorder t3 to top of Todo column (position 0)
    await moveTicket(admin.id, t3.id, {
      targetColumnId: todoCol.id,
      targetPosition: 0,
    });

    let currentBoard = await getBoardWithDetails(admin.id, board.id);
    const todoTickets = currentBoard.tickets
      .filter((t) => t.columnId === todoCol.id)
      .sort((a, b) => a.position - b.position);
    expect(todoTickets.map((t) => t.key)).toEqual([
      "STOR-3",
      "STOR-1",
      "STOR-2",
    ]);

    // Move t1 to In Progress
    await moveTicket(admin.id, t1.id, {
      targetColumnId: inProgCol.id,
      targetPosition: 0,
    });

    currentBoard = await getBoardWithDetails(admin.id, board.id);
    const inProgTickets = currentBoard.tickets.filter(
      (t) => t.columnId === inProgCol.id
    );
    expect(inProgTickets.map((t) => t.key)).toEqual(["STOR-1"]);

    // Update ticket fields & add comment
    await updateTicket(admin.id, t1.id, {
      priority: "urgent",
      title: "Ticket One Updated",
    });
    await addComment(admin.id, t1.id, {
      body: "Investigating WAL segment compaction.",
    });

    const details = await getTicketFullDetails(admin.id, t1.id);
    expect(details.comments.length).toBe(1);
    expect(details.comments[0].body).toContain("WAL segment compaction");

    const actions = details.activities.map((a) => a.action);
    expect(actions).toContain("ticket.created");
    expect(actions).toContain("ticket.moved");
    expect(actions).toContain("ticket.updated");
    expect(actions).toContain("comment.added");

    // Delete t3
    await deleteTicket(admin.id, t3.id);
  });

  it("uploads attachments to MinIO, enforces size/type limits, downloads via presigned URL, attaches GitHub/GitLab links, and indexes FTS with RBAC scoping", async () => {
    const admin = (
      await registerUser({
        email: "search-owner@patchwork.dev",
        password: "Password123!",
        name: "Search Owner",
      })
    ).user;
    const otherUser = (
      await registerUser({
        email: "other-org@patchwork.dev",
        password: "Password123!",
        name: "Other Org User",
      })
    ).user;

    const org = await createOrg(admin.id, { name: "Search & MinIO Org" });
    const team = await createTeam(admin.id, org.id, { name: "Core Search" });
    const project = await createProject(admin.id, team.id, {
      name: "Search Indexer",
      key: "SRCH",
    });
    const board = await createBoard(admin.id, project.id, {
      name: "Search Board",
    });

    const ticket = await createTicket(admin.id, board.id, {
      title: "Implement hyperscale btree cursor",
      description: "Handles distributed shard rebalancing cleanly.",
      labels: ["sharding"],
    });

    await addComment(admin.id, ticket.id, {
      body: "Verified quorum replication with raft consensus.",
    });

    // Reject disallowed file type (.exe)
    await expect(
      uploadTicketAttachment(admin.id, ticket.id, {
        filename: "malware.exe",
        contentType: "application/x-msdownload",
        buffer: Buffer.from("MZ-fake-binary"),
      })
    ).rejects.toThrow(/Unsupported file type/);

    // Reject oversized file (> MAX_ATTACHMENT_BYTES)
    const oversizedBuffer = Buffer.alloc(6 * 1024 * 1024, "a");
    await expect(
      uploadTicketAttachment(admin.id, ticket.id, {
        filename: "huge.txt",
        contentType: "text/plain",
        buffer: oversizedBuffer,
      })
    ).rejects.toThrow(/exceeds maximum limit/);

    // Upload valid Markdown/Text file to MinIO and index its contents
    const textPayload =
      "Runbook note: xenomorphicbackpressuretoken is triggered when queue depth exceeds 4096.";
    const uploadedTxt = await uploadTicketAttachment(admin.id, ticket.id, {
      filename: "runbook.md",
      contentType: "text/markdown",
      buffer: Buffer.from(textPayload, "utf8"),
    });
    expect(uploadedTxt.downloadUrl).toContain("http://127.0.0.1:9000");

    // Download via presigned URL from MinIO and verify exact content
    const dlUrl = await getAttachmentDownloadUrl(admin.id, uploadedTxt.id);
    const dlRes = await fetch(dlUrl);
    expect(dlRes.ok).toBe(true);
    const downloadedBody = await dlRes.text();
    expect(downloadedBody).toBe(textPayload);

    // Upload valid PDF attachment and verify text extraction & indexing
    const minimalPdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj
4 0 obj << /Length 55 >> stream
BT /F1 12 Tf 72 712 Td (chronoquantumtelemetry specification) Tj ET
endstream endobj
xref
0 5
0000000000 65535 f 
trailer << /Root 1 0 R /Size 5 >>
startxref
250
%%EOF`;
    await uploadTicketAttachment(admin.id, ticket.id, {
      filename: "architecture.pdf",
      contentType: "application/pdf",
      buffer: Buffer.from(minimalPdf, "utf8"),
    });

    // Attach GitHub PR and GitLab MR links
    const ghLink = await addTicketLink(admin.id, ticket.id, {
      url: "https://github.com/acme/patchwork/pull/108",
    });
    expect(ghLink.provider).toBe("github");
    expect(ghLink.kind).toBe("pr");
    expect(ghLink.externalRef).toBe("acme/patchwork#108");

    const glLink = await addTicketLink(admin.id, ticket.id, {
      url: "https://gitlab.com/acme/patchwork/-/merge_requests/55",
    });
    expect(glLink.provider).toBe("gitlab");
    expect(glLink.kind).toBe("mr");
    expect(glLink.externalRef).toBe("acme/patchwork!55");

    const fullAfterLinks = await getTicketFullDetails(admin.id, ticket.id);
    expect(fullAfterLinks.links.length).toBe(2);

    await removeTicketLink(admin.id, glLink.id);
    const fullAfterRemove = await getTicketFullDetails(admin.id, ticket.id);
    expect(fullAfterRemove.links.length).toBe(1);

    // Full-Text Search tests:
    // 1. Search ticket title/description
    const ticketHits = await searchWorkspace(admin.id, "hyperscale rebalancing");
    expect(ticketHits.some((h) => h.kind === "ticket" && h.ticketId === ticket.id)).toBe(
      true
    );
    expect(ticketHits[0].snippet).toContain("<mark>");

    // 2. Search comment body
    const commentHits = await searchWorkspace(admin.id, "quorum raft");
    expect(
      commentHits.some((h) => h.kind === "comment" && h.ticketId === ticket.id)
    ).toBe(true);

    // 3. Search extracted Markdown attachment text
    const attachmentHits = await searchWorkspace(
      admin.id,
      "xenomorphicbackpressuretoken"
    );
    expect(
      attachmentHits.some(
        (h) => h.kind === "attachment" && h.ticketId === ticket.id
      )
    ).toBe(true);

    // 4. Search extracted PDF attachment text
    const pdfHits = await searchWorkspace(admin.id, "chronoquantumtelemetry");
    expect(
      pdfHits.some((h) => h.kind === "attachment" && h.ticketId === ticket.id)
    ).toBe(true);

    // 5. Permission scoping: otherUser (not in org/team) gets 0 results
    const unauthorizedHits = await searchWorkspace(
      otherUser.id,
      "xenomorphicbackpressuretoken"
    );
    expect(unauthorizedHits.length).toBe(0);

    await deleteAttachment(admin.id, uploadedTxt.id);
  });

  it("delivers real-time ticket move events over PostgreSQL LISTEN/NOTIFY", async () => {
    const admin = (
      await registerUser({
        email: "realtime@patchwork.dev",
        password: "Password123!",
        name: "Realtime Tester",
      })
    ).user;
    const org = await createOrg(admin.id, { name: "Realtime Org" });
    const team = await createTeam(admin.id, org.id, { name: "Realtime Team" });
    const project = await createProject(admin.id, team.id, {
      name: "Event Bus",
      key: "EVNT",
    });
    const board = await createBoard(admin.id, project.id, {
      name: "Live Board",
    });

    const ticket = await createTicket(admin.id, board.id, {
      columnId: board.columns[0].id,
      title: "Broadcast move over LISTEN/NOTIFY",
    });

    const receivedEvents: RealtimeEvent[] = [];
    const unsubscribe = await realtimeHub.subscribe((ev) => {
      if (ev.boardId === board.id && ev.type === "ticket.moved") {
        receivedEvents.push(ev);
      }
    });

    try {
      await moveTicket(admin.id, ticket.id, {
        targetColumnId: board.columns[2].id,
      });

      // Wait briefly for PostgreSQL async notification delivery
      for (let i = 0; i < 20; i++) {
        if (receivedEvents.length > 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
      expect(receivedEvents[0].ticketId).toBe(ticket.id);
      expect(receivedEvents[0].payload.toColumnId).toBe(board.columns[2].id);
    } finally {
      unsubscribe();
    }

    // Change 1: Column reorder publishes `column.reordered` event to realtime SSE channel
    const reorderedEvents: RealtimeEvent[] = [];
    const unsubReorder = await realtimeHub.subscribe((ev) => {
      if (ev.boardId === board.id && ev.type === "column.reordered") {
        reorderedEvents.push(ev);
      }
    });

    try {
      const allColIds = board.columns.map((c) => c.id);
      const reorderedIds = [allColIds[1], allColIds[0], ...allColIds.slice(2)];
      await reorderColumns(admin.id, board.id, reorderedIds);

      for (let i = 0; i < 20; i++) {
        if (reorderedEvents.length > 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(reorderedEvents.length).toBeGreaterThanOrEqual(1);
      expect(reorderedEvents[0].type).toBe("column.reordered");
      expect(reorderedEvents[0].boardId).toBe(board.id);
      const payloadCols = (reorderedEvents[0].payload as { columns?: Array<{ id: string }> })?.columns;
      expect(payloadCols?.[0]?.id).toBe(board.columns[1].id);

      // Fractional single-column update updates position of only 1 row
      const targetCol = board.columns[1];
      const updatedCols = await reorderColumns(admin.id, board.id, {
        columnId: targetCol.id,
        position: 99.5,
      });
      const foundCol = updatedCols.find((c) => c.id === targetCol.id);
      expect(foundCol?.position).toBe(99.5);
    } finally {
      unsubReorder();
    }

    // Change 2: Static verification of SSE status pill removal and inline notice
    const appSource = fs.readFileSync(
      path.join(process.cwd(), "src/components/PatchworkApp.tsx"),
      "utf8"
    );
    expect(appSource).not.toContain('data-testid="sse-status"');
    expect(appSource).not.toMatch(/Live|Connecting\.\.\.|Offline/);
    expect(appSource).toContain("Updates paused. Refresh to reconnect.");
  });

  it("executes CLI installer end-to-end: --check, --non-interactive fresh install, state detection (fresh/partial/complete), non-destructive repair, .env backup, and destructive reset", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "patchwork-cli-test-"));
    const tmpEnvPath = path.join(tmpRoot, ".env");
    const tmpMinioDataDir = path.join(tmpRoot, ".minio-data");
    const tmpLogsDir = path.join(tmpRoot, "logs");
    const tmpBackupsDir = path.join(tmpRoot, "backups");
    const cliDbName = "patchwork_cli_test";
    const cliBucket = `patchwork-cli-${Date.now()}`;

    // Symlink/copy ./bin/minio(.exe) so checkMinioBinary(tmpRoot) finds it
    const { binPath } = await import("../scripts/lib/platform.mjs");
    const minioInfo = binPath("minio");
    const tmpBinDir = path.join(tmpRoot, "bin");
    fs.mkdirSync(tmpBinDir, { recursive: true });
    const srcBin = minioInfo.path;
    const dstBin = path.join(tmpBinDir, minioInfo.file);
    try {
      fs.symlinkSync(srcBin, dstBin);
    } catch {
      fs.copyFileSync(srcBin, dstBin);
    }

    const prevEnv = {
      SETUP_PROJECT_DIR: process.env.SETUP_PROJECT_DIR,
      SETUP_ENV_PATH: process.env.SETUP_ENV_PATH,
      SETUP_MINIO_DATA_DIR: process.env.SETUP_MINIO_DATA_DIR,
      SETUP_LOGS_DIR: process.env.SETUP_LOGS_DIR,
      SETUP_BACKUPS_DIR: process.env.SETUP_BACKUPS_DIR,
      SETUP_DB_NAME: process.env.SETUP_DB_NAME,
      SETUP_DB_USER: process.env.SETUP_DB_USER,
      SETUP_DB_PASSWORD: process.env.SETUP_DB_PASSWORD,
      SETUP_S3_BUCKET: process.env.SETUP_S3_BUCKET,
      SETUP_S3_ACCESS_KEY: process.env.SETUP_S3_ACCESS_KEY,
      SETUP_S3_SECRET_KEY: process.env.SETUP_S3_SECRET_KEY,
      SETUP_CREATE_TEST_DB: process.env.SETUP_CREATE_TEST_DB,
    };

    process.env.SETUP_PROJECT_DIR = tmpRoot;
    process.env.SETUP_ENV_PATH = tmpEnvPath;
    process.env.SETUP_MINIO_DATA_DIR = tmpMinioDataDir;
    process.env.SETUP_LOGS_DIR = tmpLogsDir;
    process.env.SETUP_BACKUPS_DIR = tmpBackupsDir;
    process.env.SETUP_DB_NAME = cliDbName;
    process.env.SETUP_DB_USER = "postgres";
    process.env.SETUP_DB_PASSWORD = "postgres";
    process.env.SETUP_S3_BUCKET = cliBucket;
    process.env.SETUP_S3_ACCESS_KEY = "minioadmin";
    process.env.SETUP_S3_SECRET_KEY = "minioadmin";
    process.env.SETUP_CREATE_TEST_DB = "false";

    try {
      // Ensure cliDbName does not exist initially
      await pool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [cliDbName]
      );
      await pool.query(`DROP DATABASE IF EXISTS "${cliDbName}"`);

      // 1. --check on a fresh environment detects "fresh", prints the status table, and makes zero changes
      const checkChunks: string[] = [];
      const checkOutStream = new PassThrough();
      checkOutStream.on("data", (c) => checkChunks.push(c.toString("utf8")));

      const checkFresh = await runCliSetup(["--check"], {
        outputStream: checkOutStream,
      });
      expect(checkFresh.mode).toBe("check");
      expect(checkFresh.state?.overallState).toBe("fresh");
      expect(checkChunks.join("")).toContain("Detected Install State: FRESH");
      expect(fs.existsSync(tmpEnvPath)).toBe(false);
      expect(fs.existsSync(tmpLogsDir)).toBe(false);

      // 2. Fresh install prints NO status table, supports --no-start, writes encrypted token,
      // and Fix 4: default install does NOT create patchwork_test, never shows the test DB prompt, and never writes .env.test or TEST_DATABASE_URL
      const installChunks: string[] = [];
      const installOutStream = new PassThrough();
      installOutStream.on("data", (c) => installChunks.push(c.toString("utf8")));

      const installRes = await runCliSetup(["--non-interactive", "--no-start"], {
        outputStream: installOutStream,
      });
      expect(installRes.mode).toBe("fresh-install");
      expect(installRes.server?.skipped).toBe(true);
      expect(installRes.testDbCreated).toBe(false);
      expect(installRes.testDatabaseUrl).toBeNull();
      expect(fs.existsSync(tmpEnvPath)).toBe(true);
      expect(fs.existsSync(path.join(tmpRoot, ".env.test"))).toBe(false);

      const installStdout = installChunks.join("");
      // Fix 1 check: Fresh install never prints "Detected Install State" table
      expect(installStdout).not.toContain("Detected Install State:");
      // Fix 4 check: Default install never mentions or prompts for patchwork_test
      expect(installStdout).not.toContain("patchwork_test");
      expect(installStdout).not.toContain("Set up a development environment");

      const envContent1 = fs.readFileSync(tmpEnvPath, "utf8");
      expect(envContent1).toContain(`DATABASE_URL=postgres://postgres:postgres@localhost:5432/${cliDbName}`);
      expect(envContent1).not.toContain("TEST_DATABASE_URL");
      expect(envContent1).not.toContain("patchwork_test");
      expect(envContent1).toContain("TOKEN_ENCRYPTION_KEY=");
      const keyMatch1 = envContent1.match(/TOKEN_ENCRYPTION_KEY=([0-9a-fA-F]{64})/);
      expect(keyMatch1).toBeTruthy();
      const initialKey = keyMatch1![1];

      // Verify state is now "complete" and decryptable
      const stateComplete = await detectInstallState({
        projectDir: tmpRoot,
        envPath: tmpEnvPath,
        minioDataDir: tmpMinioDataDir,
        checkMinioAnyway: true,
      });
      expect(stateComplete.overallState).toBe("complete");
      expect(stateComplete.token.exists).toBe(true);
      expect(stateComplete.token.decryptable).toBe(true);

      // Verify plaintext token is absent from .env and setup logs
      const pgCli = new (await import("pg")).default.Pool({
        connectionString: installRes.databaseUrl,
      });
      let decryptedToken1 = "";
      let initialCiphertext = "";
      try {
        const tokQ = await pgCli.query(
          "SELECT ciphertext, iv, auth_tag FROM setup_token WHERE id = 'default'"
        );
        initialCiphertext = tokQ.rows[0].ciphertext;
        decryptedToken1 = decryptSetupToken(
          {
            ciphertext: tokQ.rows[0].ciphertext,
            iv: tokQ.rows[0].iv,
            authTag: tokQ.rows[0].auth_tag,
          },
          initialKey
        );
        expect(decryptedToken1.length).toBe(32);
        expect(envContent1).not.toContain(decryptedToken1);

        const logContent = fs.readFileSync(installRes.logPath!, "utf8");
        expect(logContent).not.toContain(decryptedToken1);
        expect(logContent).not.toContain(initialKey);
      } finally {
        await pgCli.end();
      }

      // 3. Rerunning on an existing install:
      // 3a. Interactive menu on existing install shows "Existing installation detected." WITHOUT status table, navigated with arrow keys
      const menuInput = new PassThrough();
      const menuChunks: string[] = [];
      const menuOut = new PassThrough();
      menuOut.on("data", (c) => menuChunks.push(c.toString("utf8")));
      menuInput.end("\x1b[B\x1b[B\x1b[B\r"); // Arrow-down 3x + Enter -> Exit
      const menuExitRes = await runCliSetup([], {
        inputStream: menuInput,
        outputStream: menuOut,
        isTTY: true,
      });
      expect(menuExitRes.mode).toBe("exit");
      expect(menuChunks.join("")).toContain("Existing installation detected.");
      expect(menuChunks.join("")).not.toContain("Detected Install State:");
      expect(applyAnsiToScreenLines(menuChunks.join(""))).toContain("✔ Action: exit");

      // 3b. Choosing "Show status only" via arrow keys (\x1b[B\x1b[B\r) prints the status table
      const statusInput = new PassThrough();
      const statusChunks: string[] = [];
      const statusOut = new PassThrough();
      statusOut.on("data", (c) => statusChunks.push(c.toString("utf8")));
      statusInput.end("\x1b[B\x1b[B\r");
      const statusRes = await runCliSetup([], {
        inputStream: statusInput,
        outputStream: statusOut,
        isTTY: true,
      });
      expect(statusRes.mode).toBe("status");
      expect(statusChunks.join("")).toContain("Detected Install State: COMPLETE");

      // 3c. Rerunning with --non-interactive on a healthy install changes nothing
      const rerunHealthy = await runCliSetup(["--non-interactive", "--no-start"]);
      expect(rerunHealthy.mode).toBe("noop-complete");
      const backupsAfterNoop = fs
        .readdirSync(tmpRoot)
        .filter((f) => f.startsWith(".env.bak."));
      expect(backupsAfterNoop.length).toBe(0);
      expect(fs.readFileSync(tmpEnvPath, "utf8")).toBe(envContent1);

      // 3d. Fix 2: Token confirmation ('saved') erases token from terminal buffer, re-prompts on wrong input, zeroes Buffer, and unconfirmed token forces Reset
      const createdTok = await createAndStoreAdminToken({
        databaseUrl: installRes.databaseUrl,
        encryptionKey: initialKey,
        confirmed: false,
      });
      const secretTokStr = createdTok.tokenBuffer.toString("utf8");

      // Simulate terminal closing before typing 'saved' -> leaves token unconfirmed
      const prematureCloseIn = new PassThrough();
      const prematureCloseOut = new PassThrough();
      prematureCloseIn.end("wrong-word\n"); // EOF before 'saved'
      await expect(
        displayAndConfirmAdminToken({
          tokenBuffer: Buffer.from(secretTokStr, "utf8"),
          databaseUrl: installRes.databaseUrl,
          inputStream: prematureCloseIn,
          outputStream: prematureCloseOut,
          isTTY: true,
          ansiSupported: true,
        })
      ).rejects.toThrow(/Terminal closed before Admin Setup Token was confirmed/i);

      // Next run detects unconfirmed token and offers ONLY Reset (Repair is blocked)
      await expect(
        runCliSetup(["--non-interactive", "--action=repair"])
      ).rejects.toThrow(/only option is Reset/i);

      const unconfirmedMenuIn = new PassThrough();
      const unconfirmedMenuChunks: string[] = [];
      const unconfirmedMenuOut = new PassThrough();
      unconfirmedMenuOut.on("data", (c) =>
        unconfirmedMenuChunks.push(c.toString("utf8"))
      );
      unconfirmedMenuIn.end("\x1b[B\r"); // Arrow-down to Exit + Enter
      const unconfirmedMenuRes = await runCliSetup([], {
        inputStream: unconfirmedMenuIn,
        outputStream: unconfirmedMenuOut,
        isTTY: true,
      });
      expect(unconfirmedMenuRes.onlyOptionIsReset).toBe(true);
      expect(unconfirmedMenuChunks.join("")).toContain("only option is Reset");

      // Now test Fix 5:
      // - Enter keypress buffered before the prompt does not trigger an error
      // - Empty input is ignored silently
      // - `yes` prints the "Invalid input" error and re-prompts
      // - `saved`, ` SAVED `, and `Saved` are accepted
      // - Ctrl+C clears the token section
      const bufferedEnterIn = new PassThrough();
      const bufferedEnterChunks: string[] = [];
      const bufferedEnterOut = new PassThrough();
      bufferedEnterOut.on("data", (c) =>
        bufferedEnterChunks.push(c.toString("utf8"))
      );
      // Buffer an Enter keypress BEFORE displayAndConfirmAdminToken is called
      bufferedEnterIn.write("\n");
      setTimeout(() => {
        // Send another empty Enter after prompt is shown, then "saved"
        bufferedEnterIn.write("\n");
        bufferedEnterIn.write("   \n");
        bufferedEnterIn.end("saved\n");
      }, 130);

      const tokBuf1 = Buffer.from(secretTokStr, "utf8");
      await displayAndConfirmAdminToken({
        tokenBuffer: tokBuf1,
        databaseUrl: installRes.databaseUrl,
        inputStream: bufferedEnterIn,
        outputStream: bufferedEnterOut,
        isTTY: true,
        ansiSupported: true,
      });
      expect(tokBuf1.every((b) => b === 0)).toBe(true);
      // Neither buffered Enter nor empty input after prompt should ever print "Invalid input"
      expect(bufferedEnterChunks.join("")).not.toContain("Invalid input");
      expect(applyAnsiToScreenLines(bufferedEnterChunks.join(""))).toContain(
        "✔ Admin token saved."
      );

      // Test ` SAVED ` and `Saved` case-insensitive + trimmed acceptance
      for (const variant of [" SAVED \n", "Saved\n"]) {
        const varIn = new PassThrough();
        const varOut = new PassThrough();
        setTimeout(() => varIn.end(variant), 120);
        const varBuf = Buffer.from(secretTokStr, "utf8");
        const varRes = await displayAndConfirmAdminToken({
          tokenBuffer: varBuf,
          databaseUrl: installRes.databaseUrl,
          inputStream: varIn,
          outputStream: varOut,
          isTTY: true,
          ansiSupported: true,
        });
        expect(varRes.confirmed).toBe(true);
        expect(varBuf.every((b) => b === 0)).toBe(true);
      }

      // Test Ctrl+C clears the token section and zeroes the buffer
      const ctrlCIn = new PassThrough();
      const ctrlCChunks: string[] = [];
      const ctrlCOut = new PassThrough();
      ctrlCOut.on("data", (c) => ctrlCChunks.push(c.toString("utf8")));
      setTimeout(() => ctrlCIn.write("\x03"), 120);
      const ctrlCBuf = Buffer.from(secretTokStr, "utf8");
      await expect(
        displayAndConfirmAdminToken({
          tokenBuffer: ctrlCBuf,
          databaseUrl: installRes.databaseUrl,
          inputStream: ctrlCIn,
          outputStream: ctrlCOut,
          isTTY: true,
          ansiSupported: true,
        })
      ).rejects.toThrow(/Interrupted \(Ctrl\+C\)/i);
      expect(ctrlCBuf.every((b) => b === 0)).toBe(true);
      expect(applyAnsiToScreenLines(ctrlCChunks.join(""))).not.toContain(
        secretTokStr
      );

      // Test typing 'yes' prints the "Invalid input" error and re-prompts, then 'saved' erases token section, leaves `✔ Admin token saved.`, zeroes buffer
      const confirmIn = new PassThrough();
      const confirmRawChunks: string[] = [];
      const confirmOut = new PassThrough();
      confirmOut.on("data", (c) => confirmRawChunks.push(c.toString("utf8")));
      confirmIn.write("yes\n");
      confirmIn.end("saved\n");

      await displayAndConfirmAdminToken({
        tokenBuffer: createdTok.tokenBuffer,
        databaseUrl: installRes.databaseUrl,
        inputStream: confirmIn,
        outputStream: confirmOut,
        isTTY: true,
        ansiSupported: true,
      });

      // Buffer must be overwritten with zeros
      expect(createdTok.tokenBuffer.every((b) => b === 0)).toBe(true);

      // Raw stream must have printed "Invalid input" after 'yes', and final screen must have erased everything except `✔ Admin token saved.`
      const rawTtyStream = confirmRawChunks.join("");
      expect(rawTtyStream).toContain("Invalid input");
      const renderedScreen = applyAnsiToScreenLines(rawTtyStream);
      expect(renderedScreen).toContain("✔ Admin token saved.");
      expect(renderedScreen).not.toContain(secretTokStr);

      // Stdout after the final clear sequence (\x1b[3J) must contain no token
      const afterLastClear = rawTtyStream.split("\x1b[3J").pop() || "";
      expect(afterLastClear).toContain("✔ Admin token saved.");
      expect(afterLastClear).not.toContain(secretTokStr);

      // Re-capture current ciphertext after confirmation test
      const pgRefreshTok = new (await import("pg")).default.Pool({
        connectionString: installRes.databaseUrl,
      });
      try {
        const tq = await pgRefreshTok.query(
          "SELECT ciphertext FROM setup_token WHERE id = 'default'"
        );
        initialCiphertext = tq.rows[0].ciphertext;
        decryptedToken1 = secretTokStr;
      } finally {
        await pgRefreshTok.end();
      }

      // 4. State detection for partial installs:
      // 4a. Missing bucket -> "partial"
      await emptyAndRemoveMinioBucket({
        endpoint: "http://127.0.0.1:9000",
        accessKeyId: "minioadmin",
        secretAccessKey: "minioadmin",
        bucket: cliBucket,
      });
      const stateMissingBucket = await detectInstallState({
        projectDir: tmpRoot,
        envPath: tmpEnvPath,
        minioDataDir: tmpMinioDataDir,
        checkMinioAnyway: true,
      });
      expect(stateMissingBucket.overallState).toBe("partial");
      expect(stateMissingBucket.minio.bucketExists).toBe(false);

      // 4b. Pending migration (drop tickets table) & missing .env key -> "partial"
      const pgDrop = new (await import("pg")).default.Pool({
        connectionString: installRes.databaseUrl,
      });
      try {
        await pgDrop.query("DROP TABLE ticket_links CASCADE");
      } finally {
        await pgDrop.end();
      }

      // Remove CSRF_SECRET from .env to test .env repair & .env.bak creation
      const envWithoutCsrf = envContent1
        .split("\n")
        .filter((line) => !line.startsWith("CSRF_SECRET="))
        .join("\n");
      fs.writeFileSync(tmpEnvPath, envWithoutCsrf, "utf8");

      const statePendingMig = await detectInstallState({
        projectDir: tmpRoot,
        envPath: tmpEnvPath,
        minioDataDir: tmpMinioDataDir,
        checkMinioAnyway: true,
      });
      expect(statePendingMig.overallState).toBe("partial");
      expect(statePendingMig.migrations.allTablesPresent).toBe(false);

      // 5. Repair via CLI prints the status table first, restores missing pieces, creates .env backup, and preserves TOKEN_ENCRYPTION_KEY and setup_token
      const repairCliChunks: string[] = [];
      const repairCliOut = new PassThrough();
      repairCliOut.on("data", (c) => repairCliChunks.push(c.toString("utf8")));
      const repairCliRes = await runCliSetup(
        ["--non-interactive", "--action=repair"],
        { outputStream: repairCliOut }
      );
      expect(repairCliRes.mode).toBe("repair");
      expect(repairCliChunks.join("")).toContain("Detected Install State: PARTIAL");
      const repairResult = repairCliRes.repair!;
      expect(repairResult.envBackupPath).toBeTruthy();
      expect(fs.existsSync(repairResult.envBackupPath!)).toBe(true);
      expect(repairResult.state.overallState).toBe("complete");
      expect(repairResult.state.minio.bucketExists).toBe(true);
      expect(repairResult.state.migrations.allTablesPresent).toBe(true);
      expect(repairResult.state.env.values.TOKEN_ENCRYPTION_KEY).toBe(initialKey);

      // Verify setup_token ciphertext was not regenerated by Repair
      const pgVerifyToken = new (await import("pg")).default.Pool({
        connectionString: installRes.databaseUrl,
      });
      try {
        const tokQ2 = await pgVerifyToken.query(
          "SELECT ciphertext FROM setup_token WHERE id = 'default'"
        );
        expect(tokQ2.rows[0].ciphertext).toBe(initialCiphertext);
      } finally {
        await pgVerifyToken.end();
      }

      // 5b. If TOKEN_ENCRYPTION_KEY is missing, Repair does NOT regenerate it and reports Reset is required
      const envWithoutEncKey = fs
        .readFileSync(tmpEnvPath, "utf8")
        .split("\n")
        .filter((line) => !line.startsWith("TOKEN_ENCRYPTION_KEY="))
        .join("\n");
      fs.writeFileSync(tmpEnvPath, envWithoutEncKey, "utf8");

      const repairMissingKey = await runRepair({
        projectDir: tmpRoot,
        envPath: tmpEnvPath,
        minioDataDir: tmpMinioDataDir,
      });
      expect(
        repairMissingKey.manualActions.some((m) =>
          m.includes("only fix is to run Reset")
        )
      ).toBe(true);
      expect(repairMissingKey.state.env.values.TOKEN_ENCRYPTION_KEY).toBeUndefined();

      // 6. Reset requires typed confirmation of database name + second confirmation
      await expect(
        runReset({
          projectDir: tmpRoot,
          envPath: tmpEnvPath,
          minioDataDir: tmpMinioDataDir,
          backupsDir: tmpBackupsDir,
          dbName: cliDbName,
          typedConfirmation: "wrong_db_name",
          secondConfirmation: true,
        })
      ).rejects.toThrow(/does not match database name/i);

      await expect(
        runReset({
          projectDir: tmpRoot,
          envPath: tmpEnvPath,
          minioDataDir: tmpMinioDataDir,
          backupsDir: tmpBackupsDir,
          dbName: cliDbName,
          typedConfirmation: cliDbName,
          secondConfirmation: false,
        })
      ).rejects.toThrow(/second yes\/no confirmation/i);

      // Valid Reset wipes data and issues a new token and a new TOKEN_ENCRYPTION_KEY
      const resetRes = await runReset({
        projectDir: tmpRoot,
        envPath: tmpEnvPath,
        minioDataDir: tmpMinioDataDir,
        backupsDir: tmpBackupsDir,
        dbName: cliDbName,
        s3Bucket: cliBucket,
        typedConfirmation: cliDbName,
        secondConfirmation: true,
        backupDb: true,
        reinstall: true,
      });
      expect(resetRes.resetCompleted).toBe(true);
      expect(resetRes.backupResult.dbBackupPath).toBeTruthy();
      expect(resetRes.reinstalled).toBeTruthy();

      const newKey = resetRes.reinstalled!.tokenEncryptionKey;
      const newTokenPlain = resetRes.reinstalled!.tokenBuffer.toString("utf8");
      resetRes.reinstalled!.tokenBuffer.fill(0);

      expect(newKey).not.toBe(initialKey);
      expect(newTokenPlain).not.toBe(decryptedToken1);

      // Old key cannot decrypt new token ciphertext
      expect(() =>
        decryptSetupToken(resetRes.reinstalled!.encryptedToken, initialKey)
      ).toThrow();
      // Reset on non-dev install must not create .env.test
      expect(fs.existsSync(path.join(tmpRoot, ".env.test"))).toBe(false);

      // 6b. Fix 4: Running with --dev creates patchwork_test and writes .env.test, while keeping production .env clean
      fs.unlinkSync(tmpEnvPath);
      await pool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [cliDbName]
      );
      await pool.query(`DROP DATABASE IF EXISTS "${cliDbName}"`);

      const devInstallOut = new PassThrough();
      const devInstallRes = await runCliSetup(
        ["--non-interactive", "--dev", "--no-start"],
        { outputStream: devInstallOut }
      );
      expect(devInstallRes.testDbCreated).toBe(true);
      expect(devInstallRes.testDatabaseUrl).toContain("/patchwork_test");
      const tmpEnvTestPath = path.join(tmpRoot, ".env.test");
      expect(fs.existsSync(tmpEnvTestPath)).toBe(true);
      expect(fs.readFileSync(tmpEnvTestPath, "utf8")).toContain(
        "DATABASE_URL=postgres://postgres:postgres@localhost:5432/patchwork_test"
      );
      const prodEnvAfterDev = fs.readFileSync(tmpEnvPath, "utf8");
      expect(prodEnvAfterDev).not.toContain("TEST_DATABASE_URL");
      expect(prodEnvAfterDev).not.toContain("patchwork_test");

      // 7. Fix 3: Automatic server start, port-in-use fallback + .env update, health check, and clean stop via `npm run stop`
      const occupiedPort = 3145;
      const blockerServer = net.createServer();
      await new Promise<void>((resolve) =>
        blockerServer.listen(occupiedPort, "127.0.0.1", () => resolve())
      );

      try {
        process.env.SETUP_APP_PORT = String(occupiedPort);
        process.env.SETUP_SKIP_BUILD_IF_BUILT = "true";

        // Drop DB & .env so runCliSetup performs a fresh install with background server start
        fs.unlinkSync(tmpEnvPath);
        await pool.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [cliDbName]
        );
        await pool.query(`DROP DATABASE IF EXISTS "${cliDbName}"`);

        const startChunks: string[] = [];
        const startOut = new PassThrough();
        startOut.on("data", (c) => startChunks.push(c.toString("utf8")));

        const autoStartRes = await runCliSetup(
          ["--non-interactive", "--no-open"],
          { outputStream: startOut }
        );
        expect(autoStartRes.server?.started).toBe(true);
        expect(autoStartRes.server?.port).toBeGreaterThan(occupiedPort);

        const activePort = autoStartRes.server!.port;
        const startOutputText = startChunks.join("");
        expect(startOutputText).toContain(
          `✔ Patchwork is running → http://localhost:${activePort}/setup`
        );

        // Verify .env was updated with the new free port
        const updatedEnv = fs.readFileSync(tmpEnvPath, "utf8");
        expect(updatedEnv).toContain(`PORT=${activePort}`);
        expect(updatedEnv).toContain(`APP_URL=http://localhost:${activePort}`);

        // Verify health check responds 200 on the started server
        const healthCheck = await fetch(
          `http://localhost:${activePort}/api/health`
        );
        expect(healthCheck.status).toBe(200);

        // Stop the background server via .patchwork.pid (`npm run stop` helper)
        const stopRes = stopServerFromPidFile(tmpRoot);
        expect(stopRes.stopped).toBe(true);
      } finally {
        delete process.env.SETUP_APP_PORT;
        delete process.env.SETUP_SKIP_BUILD_IF_BUILT;
        stopServerFromPidFile(tmpRoot);
        await new Promise<void>((resolve) => blockerServer.close(() => resolve()));
      }

      // 8. Static & runtime verification of @clack/prompts style (no '?' prefix, no forbidden imports, arrow-key navigation, single-line collapsing)
      const collectScriptFiles = (dir: string): string[] => {
        const out: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            out.push(...collectScriptFiles(full));
          } else if (entry.isFile()) {
            out.push(full);
          }
        }
        return out;
      };

      const scriptFiles = collectScriptFiles(path.join(process.cwd(), "scripts"));
      expect(scriptFiles.length).toBeGreaterThan(0);

      for (const sf of scriptFiles) {
        const src = fs.readFileSync(sf, "utf8");
        // Static test: no file under scripts/ imports readline, inquirer, enquirer, prompts (standalone), or readline-sync
        expect(src).not.toMatch(
          /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'`](?:node:)?(?:readline|inquirer|enquirer|prompts|readline-sync)["'`]/
        );
        expect(src).not.toMatch(/\bcreateInterface\s*\(/);
        // Static test: no string literal in scripts/ starts a prompt message with `? `
        expect(src).not.toMatch(/["'`]\?\s+[A-Za-z]/);
      }

      const stripAnsiCodes = (str: string) =>
        str.replace(
          /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g,
          ""
        );

      const assertNoQuestionPrefix = (rawOutput: string) => {
        const strippedLines = stripAnsiCodes(rawOutput).split(/\r?\n/);
        for (const line of strippedLines) {
          const trimmedLine = line.trimStart();
          expect(trimmedLine.startsWith("?")).toBe(false);
          expect(line).not.toMatch(/^\s*\?\s+/);
        }
      };

      // Non-TTY run prints no `?` prefix
      assertNoQuestionPrefix(installStdout);

      // Runtime test: run the installer in a simulated TTY through every prompt using arrow keys and Enter
      fs.unlinkSync(tmpEnvPath);
      await pool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [cliDbName]
      );
      await pool.query(`DROP DATABASE IF EXISTS "${cliDbName}"`);

      const simTtyIn = new PassThrough();
      const simTtyChunks: string[] = [];
      const simTtyOut = new PassThrough();
      simTtyOut.on("data", (c) => simTtyChunks.push(c.toString("utf8")));

      // Prompts answered in simulated TTY:
      // 1. PostgreSQL host -> Enter (\r)
      // 2. PostgreSQL port -> Enter (\r)
      // 3. Database name -> Enter (\r)
      // 4. Database application user -> Enter (\r)
      // 5. Do you want to connect a domain? -> Down (\x1b[B), Down (\x1b[B), Up (\x1b[A), Down (\x1b[B), Enter (\r) => selects "later"
      // 6. Type 'saved' to confirm Admin Setup Token -> "saved\r"
      simTtyIn.end("\r\r\r\r\x1b[B\x1b[B\x1b[A\x1b[B\rsaved\r");

      const simTtyRes = await runCliSetup(["--no-start"], {
        inputStream: simTtyIn,
        outputStream: simTtyOut,
        isTTY: true,
      });
      expect(simTtyRes.mode).toBe("fresh-install");

      const simTtyRaw = simTtyChunks.join("");
      assertNoQuestionPrefix(simTtyRaw);

      // Raw output must contain Clack style symbols (◆, ●, ○) during interactive rendering
      expect(stripAnsiCodes(simTtyRaw)).toContain("◆");
      expect(stripAnsiCodes(simTtyRaw)).toContain("●");
      expect(stripAnsiCodes(simTtyRaw)).toContain("○");

      // Rendered screen after answering must collapse each prompt into one summary line with ✔ and no '?'
      const simTtyScreen = applyAnsiToScreenLines(simTtyRaw);
      assertNoQuestionPrefix(simTtyScreen);
      expect(simTtyScreen).toContain("✔ PostgreSQL host: localhost");
      expect(simTtyScreen).toContain("✔ PostgreSQL port: 5432");
      expect(simTtyScreen).toContain(`✔ Database name: ${cliDbName}`);
      expect(simTtyScreen).toContain("✔ Database user: postgres");
      expect(simTtyScreen).toContain(
        "✔ Domain: later (guide saved to DOMAIN_SETUP.md)"
      );
      expect(simTtyScreen).toContain("✔ Admin token saved.");
      // Question and option list must not remain on screen after collapsing
      expect(simTtyScreen).not.toContain("Do you want to connect a domain?");
      expect(simTtyScreen).not.toContain("No (use localhost / configure manually)");
      expect(fs.existsSync(path.join(tmpRoot, "DOMAIN_SETUP.md"))).toBe(true);
    } finally {
      // Restore env vars and clean up throwaway DB, bucket, and temp dir
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await emptyAndRemoveMinioBucket({
        endpoint: "http://127.0.0.1:9000",
        accessKeyId: "minioadmin",
        secretAccessKey: "minioadmin",
        bucket: cliBucket,
      });
      await pool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [cliDbName]
      );
      await pool.query(`DROP DATABASE IF EXISTS "${cliDbName}"`);
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // Best effort cleanup on Windows temp directories
      }
    }
  }, 120000);

  it("enforces email uniqueness, case-insensitive normalization, DB index, deduplication migration, setup wizard rejection & CSV duplicate filtering", async () => {
    // 1. Normalization helper
    expect(normalizeEmail("  Grace.Hopper@Navy.MIL  ")).toBe("grace.hopper@navy.mil");
    expect(normalizeEmail("")).toBe("");
    expect(normalizeEmail(null)).toBe("");
    expect(isValidEmailFormat("grace.hopper@navy.mil")).toBe(true);
    expect(isValidEmailFormat("not-an-email")).toBe(false);
    expect(isValidEmailFormat("bad@")).toBe(false);
    expect(isValidEmailFormat("bad@domain")).toBe(false);

    // 2. Database unique index on lower(email)
    const dbClient = await pool.connect();
    try {
      await dbClient.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
      // Verify users_lower_email_idx exists
      const idxCheck = await dbClient.query(
        `SELECT 1 FROM pg_indexes WHERE indexname = 'users_lower_email_idx'`
      );
      expect(idxCheck.rowCount).toBeGreaterThanOrEqual(1);

      // Attempting to insert duplicate lower(email) directly must fail with Postgres code 23505
      const testEmail = `case-unique-${Date.now()}@patchwork.dev`;
      await dbClient.query(
        `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)`,
        [testEmail, "User One", "hash1"]
      );

      let pgError: (Error & { code?: string }) | null = null;
      try {
        await dbClient.query(
          `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)`,
          [testEmail.toUpperCase(), "User Two", "hash2"]
        );
      } catch (err) {
        pgError = err as Error & { code?: string };
      }
      expect(pgError).not.toBeNull();
      expect(pgError!.code).toBe("23505");
    } finally {
      dbClient.release();
    }

    // 3. Migration deduplication & audit report
    const dedupClient = await pool.connect();
    try {
      // Temporarily drop unique index to simulate pre-migration state with existing duplicate case variants
      await dedupClient.query(`DROP INDEX IF EXISTS users_lower_email_idx`);
      const baseDupEmail = `dedup-test-${Date.now()}@example.org`;
      const res1 = await dedupClient.query(
        `INSERT INTO users (email, name, password_hash, created_at) VALUES ($1, $2, $3, NOW() - INTERVAL '1 day') RETURNING id`,
        [baseDupEmail.toLowerCase(), "Oldest Original", "hash"]
      );
      const res2 = await dedupClient.query(
        `INSERT INTO users (email, name, password_hash, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id`,
        [baseDupEmail.toUpperCase(), "Newer Duplicate", "hash"]
      );
      const oldestId = res1.rows[0].id;
      const dupId = res2.rows[0].id;

      // Run deduplication runner
      const logsDir = path.join(process.cwd(), "logs");
      const dedupResult = await deduplicateExistingEmails(dedupClient, logsDir);
      expect(dedupResult.duplicatesFound).toBeGreaterThanOrEqual(1);
      expect(dedupResult.renamedCount).toBeGreaterThanOrEqual(1);
      expect(dedupResult.reportPath).toBeTruthy();
      expect(fs.existsSync(dedupResult.reportPath!)).toBe(true);

      const reportContent = fs.readFileSync(dedupResult.reportPath!, "utf8");
      expect(reportContent).toContain(baseDupEmail.toLowerCase());
      expect(reportContent).toContain(oldestId);
      expect(reportContent).toContain(dupId);
      expect(reportContent).toContain(`+duplicate-${dupId}@invalid.local`);

      // Verify DB records: oldest unchanged, newer renamed
      const checkOld = await dedupClient.query(`SELECT email FROM users WHERE id = $1`, [oldestId]);
      expect(checkOld.rows[0].email).toBe(baseDupEmail.toLowerCase());

      const checkDup = await dedupClient.query(`SELECT email FROM users WHERE id = $1`, [dupId]);
      expect(checkDup.rows[0].email).toContain(`+duplicate-${dupId}@invalid.local`);

      // Now create unique index back cleanly
      await dedupClient.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_lower_email_idx ON users (lower(email))`);
    } finally {
      dedupClient.release();
    }

    // 4. Setup Wizard Steps & Validation
    // Reset setup state for fresh test
    await pool.query(`DELETE FROM setup_state`);
    await pool.query(`DELETE FROM orgs`);
    await pool.query(`DELETE FROM users`);
    await pool.query(`DELETE FROM setup_token`);

    const adminUniqEmail = `lead-${Date.now()}@patchwork.dev`;
    const adminSetupToken = await provisionSetupTokenInDb();

    const step1 = await runSetupStep1Admin(null, {
      name: "Founder Admin",
      email: `  ${adminUniqEmail.toUpperCase()}  `,
      password: "AdminPassword123!",
      setupToken: adminSetupToken,
    });
    expect(step1.auth).toBeDefined();
    const adminId = step1.auth!.user.id;

    // Step 2 Org
    await runSetupStep2Org(adminId, {
      name: "Aero Corp",
      slug: "aero-corp",
    });

    // Step 3 Teams
    const step3 = await runSetupStep3Teams(adminId, {
      teams: [{ name: "Flight Ops", slug: "flight-ops" }],
    });
    expect(step3.teams.length).toBe(1);

    // Attempt Step 4 with employee reusing the Step 1 admin's email -> must be rejected
    let adminCollisionErr: (Error & { message: string }) | null = null;
    try {
      await runSetupStep4Employees(adminId, {
        employees: [
          {
            name: "Clone Admin",
            email: adminUniqEmail.toLowerCase(),
            role: "member",
            teamSlug: "flight-ops",
          },
        ],
      });
    } catch (err) {
      adminCollisionErr = err as Error & { message: string };
    }
    expect(adminCollisionErr).toBeInstanceOf(EmailTakenError);
    expect(adminCollisionErr!.message).toContain("This email is already used by Founder Admin.");

    // Attempt Step 4 with intra-draft duplicate emails -> must be rejected
    const workerEmail = `worker-${Date.now()}@patchwork.dev`;
    let intraDraftDupErr: (Error & { message: string }) | null = null;
    try {
      await runSetupStep4Employees(adminId, {
        employees: [
          {
            name: "Worker A",
            email: workerEmail.toLowerCase(),
            role: "member",
            teamSlug: "flight-ops",
          },
          {
            name: "Worker B",
            email: `  ${workerEmail.toUpperCase()}  `,
            role: "member",
            teamSlug: "flight-ops",
          },
        ],
      });
    } catch (err) {
      intraDraftDupErr = err as Error & { message: string };
    }
    expect(intraDraftDupErr).toBeInstanceOf(EmailTakenError);
    expect(intraDraftDupErr!.message).toContain("This email is already used by Worker A.");

    // Validation check endpoint (GET /api/setup/validate-email)
    const reqAdminCheck = new NextRequest(
      `http://localhost/api/setup/validate-email?email=${encodeURIComponent(adminUniqEmail)}`
    );
    const resAdminCheck = await validateEmailGet(reqAdminCheck);
    const bodyAdminCheck = await resAdminCheck.json();
    expect(bodyAdminCheck.available).toBe(false);
    expect(bodyAdminCheck.message).toContain("This email is already used by Founder Admin.");

    // Validation check endpoint for new unused email -> available: true
    const freshEmail = `unused-${Date.now()}@patchwork.dev`;
    const reqFreshCheck = new NextRequest(
      `http://localhost/api/setup/validate-email?email=${encodeURIComponent(freshEmail)}`
    );
    const resFreshCheck = await validateEmailGet(reqFreshCheck);
    const bodyFreshCheck = await resFreshCheck.json();
    expect(bodyFreshCheck.available).toBe(true);

    // Autosave (saveSetupDraft) must not persist duplicate employee emails
    let autosaveDupErr: (Error & { message: string }) | null = null;
    try {
      await saveSetupDraft(adminId, {
        draftData: {
          employees: [
            { name: "Emp 1", email: workerEmail, role: "member" },
            { name: "Emp 2", email: workerEmail.toUpperCase(), role: "member" },
          ],
        },
      });
    } catch (err) {
      autosaveDupErr = err as Error & { message: string };
    }
    expect(autosaveDupErr).toBeInstanceOf(EmailTakenError);

    // Valid Step 4 provision
    const step4Valid = await runSetupStep4Employees(adminId, {
      employees: [
        {
          name: "Original Worker",
          email: workerEmail,
          role: "member",
          teamSlug: "flight-ops",
        },
      ],
    });
    expect(step4Valid.employees.length).toBe(1);

    // Requirement 8: Re-running wizard step with same employee updates in place without error or duplicate
    const step4Rerun = await runSetupStep4Employees(adminId, {
      employees: [
        {
          name: "Original Worker Updated",
          email: workerEmail.toUpperCase(),
          role: "lead",
          teamSlug: "flight-ops",
        },
      ],
    });
    expect(step4Rerun.employees.length).toBe(1);
    expect(step4Rerun.employees[0].name).toBe("Original Worker Updated");

    // 5. CSV Import: detects intra-file duplicates & existing user duplicates, imports valid rows, returns skipped report
    const existingDbUserEmail = workerEmail;
    const csvFreshEmail = `csv-ok-${Date.now()}@patchwork.dev`;
    const csvIntraDup = `csv-dup-${Date.now()}@patchwork.dev`;

    const csvData = [
      "name,email,role,team",
      `Existing Guy,${existingDbUserEmail},member,flight-ops`,
      `Valid New Guy,${csvFreshEmail},member,flight-ops`,
      `Duplicate First,${csvIntraDup},member,flight-ops`,
      `Duplicate Second,${csvIntraDup.toUpperCase()},member,flight-ops`,
    ].join("\n");

    const parsedCsv = parseEmployeeCsv(csvData, {
      existingEmails: [existingDbUserEmail],
    });
    // Valid rows imported: Valid New Guy and Duplicate First
    expect(parsedCsv.employees.length).toBe(2);
    expect(parsedCsv.employees.some((e) => e.email === csvFreshEmail)).toBe(true);
    expect(parsedCsv.employees.some((e) => e.email === csvIntraDup)).toBe(true);

    // Skipped rows report contains line number, email, and reason
    expect(parsedCsv.skippedRows.length).toBe(2);
    const skippedExisting = parsedCsv.skippedRows.find((r) => r.email === existingDbUserEmail);
    expect(skippedExisting).toBeDefined();
    expect(skippedExisting!.line).toBe(2);
    expect(skippedExisting!.reason).toBe("already exists");

    const skippedIntra = parsedCsv.skippedRows.find((r) => r.email === csvIntraDup);
    expect(skippedIntra).toBeDefined();
    expect(skippedIntra!.line).toBe(5);
    expect(skippedIntra!.reason).toBe("duplicate in file");

    // 6. Workspace User Management: Provision, Invite, and Edit
    const [activeTeam] = await pool.query(`SELECT id FROM teams LIMIT 1`).then((r) => r.rows);

    // Attempt to provision existing email in team -> throws EmailTakenError (409)
    let teamProvisionErr: (EmailTakenError & { status?: number }) | null = null;
    try {
      await addTeamMember(adminId, activeTeam.id, {
        email: workerEmail,
        name: "Worker Duplicate",
        password: "TempPassword123!",
        role: "member",
      });
    } catch (err) {
      teamProvisionErr = err as EmailTakenError & { status?: number };
    }
    expect(teamProvisionErr).toBeInstanceOf(EmailTakenError);
    expect(teamProvisionErr!.status).toBe(409);
    expect(teamProvisionErr!.message).toContain("This email is already used by Original Worker Updated.");

    // Update user to another user's email -> rejected
    let userEditCollisionErr: (EmailTakenError & { status?: number }) | null = null;
    try {
      await updateUser(adminId, adminId, {
        email: workerEmail,
      });
    } catch (err) {
      userEditCollisionErr = err as EmailTakenError & { status?: number };
    }
    expect(userEditCollisionErr).toBeInstanceOf(EmailTakenError);
    expect(userEditCollisionErr!.status).toBe(409);
    expect(userEditCollisionErr!.message).toContain("This email is already used by Original Worker Updated.");

    // Update user with their own email -> succeeds
    const userEditSelf = await updateUser(adminId, adminId, {
      name: "Founder Admin Renamed",
      email: adminUniqEmail,
    });
    expect(userEditSelf.name).toBe("Founder Admin Renamed");

    // 7. API contract: duplicate attempts return HTTP 409 with { error: "email_taken", field: "email" }
    const resTakenError = handleApiError(new EmailTakenError("This email is already used by Alice.", "Alice"));
    expect(resTakenError.status).toBe(409);
    const bodyTakenError = await resTakenError.json();
    expect(bodyTakenError).toEqual({
      error: "email_taken",
      field: "email",
      message: "This email is already used by Alice.",
      usedBy: "Alice",
    });

    // Postgres code 23505 race condition fallback
    const resPg23505 = handleApiError({ code: "23505", detail: "Key (lower(email))=(bob@example.com) already exists." });
    expect(resPg23505.status).toBe(409);
    const bodyPg23505 = await resPg23505.json();
    expect(bodyPg23505).toEqual({
      error: "email_taken",
      field: "email",
      message: "This email is already used by another user.",
    });
  }, 90000);
});

