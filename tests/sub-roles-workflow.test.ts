import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { NextRequest } from "next/server";
import pg from "pg";
import { registerUser, createSession } from "../src/lib/auth";
import {
  createOrg,
  createTeam,
  addTeamMember,
  createProject,
  createBoard,
  getBoardWithDetails,
} from "../src/lib/hierarchy";
import { createTicket, moveTicket } from "../src/lib/tickets";
import { POST as moveTicketRoute } from "../src/app/api/tickets/[ticketId]/move/route";

const DB_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test";

const pool = new pg.Pool({ connectionString: DB_URL });

describe("Sub-Role SDLC Workflow Enforcement Suite", () => {
  beforeAll(async () => {
    execSync("node scripts/dev-minio.mjs && node scripts/reset-test-db.mjs", { stdio: "pipe" });
    await pool.query(`
      INSERT INTO setup_state (id, is_completed, current_step)
      VALUES ('default', true, 7)
      ON CONFLICT (id) DO UPDATE SET is_completed = true, current_step = 7;
    `);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("enforces strict developer and tester workflow permissions with lead/admin override", async () => {
    // 1. Setup users with roles & sub-roles
    const adminUser = (
      await registerUser({
        email: `sdlc-admin-${Date.now()}@example.org`,
        password: "Password123!",
        name: "SDLC Admin",
      })
    ).user;

    const leadUser = (
      await registerUser({
        email: `sdlc-lead-${Date.now()}@example.org`,
        password: "Password123!",
        name: "SDLC Tech Lead",
      })
    ).user;

    const devUser = (
      await registerUser({
        email: `sdlc-dev-${Date.now()}@example.org`,
        password: "Password123!",
        name: "SDLC Developer",
      })
    ).user;

    const testerUser = (
      await registerUser({
        email: `sdlc-qa-${Date.now()}@example.org`,
        password: "Password123!",
        name: "SDLC QA Tester",
      })
    ).user;

    const org = await createOrg(adminUser.id, { name: "SDLC Corp" });
    const team = await createTeam(adminUser.id, org.id, { name: "Core Engineering" });

    // Assign roles & sub-roles
    await addTeamMember(adminUser.id, team.id, { userId: leadUser.id, role: "lead" });
    await addTeamMember(adminUser.id, team.id, {
      userId: devUser.id,
      role: "member",
      subRole: "developer",
    });
    await addTeamMember(adminUser.id, team.id, {
      userId: testerUser.id,
      role: "member",
      subRole: "tester",
    });

    const project = await createProject(adminUser.id, team.id, {
      name: "SDLC Platform",
      key: "SDLC",
    });

    const board = await createBoard(adminUser.id, project.id, {
      name: "Sprint Kanban",
      columns: [
        { name: "Backlog" },     // 0
        { name: "New" },         // 1
        { name: "In Progress" }, // 2
        { name: "In Review" },   // 3
        { name: "QA" },          // 4
        { name: "Done" },        // 5
      ],
    });

    const boardData = await getBoardWithDetails(adminUser.id, board.id);
    const cols = boardData.columns;
    expect(cols.length).toBe(6);

    const [colBacklog, colNew, colInProgress, colInReview, colQA, colDone] = cols;

    // --- TESTER TICKET CREATION ---
    // Tester can create tickets in Backlog and New (bug reporting)
    const bugTicket = await createTicket(testerUser.id, board.id, {
      title: "Bug: Payment webhook drops signature",
      columnId: colNew.id,
    });
    expect(bugTicket.id).toBeDefined();
    expect(bugTicket.columnId).toBe(colNew.id);

    // Tester CANNOT create ticket directly in "In Progress"
    await expect(
      createTicket(testerUser.id, board.id, {
        title: "Bug: Bypassing dev",
        columnId: colInProgress.id,
      })
    ).rejects.toThrow(/Testers cannot create tickets directly in 'In Progress'/i);

    // --- DEVELOPER MOVEMENT RULES ---
    const featureTicket = await createTicket(devUser.id, board.id, {
      title: "Feature: OAuth PKCE flow",
      columnId: colNew.id,
    });

    // Dev can pick up work from New -> In Progress
    const devProg = await moveTicket(devUser.id, featureTicket.id, {
      targetColumnId: colInProgress.id,
    });
    expect(devProg.columnId).toBe(colInProgress.id);

    // Dev can move In Progress -> In Review
    const devReview = await moveTicket(devUser.id, featureTicket.id, {
      targetColumnId: colInReview.id,
    });
    expect(devReview.columnId).toBe(colInReview.id);

    // Dev CAN move In Review -> QA (ready for testing)
    const devQA = await moveTicket(devUser.id, featureTicket.id, {
      targetColumnId: colQA.id,
    });
    expect(devQA.columnId).toBe(colQA.id);

    // Dev CANNOT sign off QA -> Done (403)
    await expect(
      moveTicket(devUser.id, featureTicket.id, { targetColumnId: colDone.id })
    ).rejects.toThrow(/Developers cannot move tickets directly to "Done"/i);

    // Dev CANNOT move tickets out of QA (403)
    await expect(
      moveTicket(devUser.id, featureTicket.id, { targetColumnId: colInProgress.id })
    ).rejects.toThrow(/Developers cannot transition tickets out of "QA"/i);

    // --- TESTER MOVEMENT RULES ---
    // Tester CANNOT start development on New -> In Progress
    await expect(
      moveTicket(testerUser.id, bugTicket.id, { targetColumnId: colInProgress.id })
    ).rejects.toThrow(/Testers cannot move tickets from.*to "In Progress"/i);

    // Dev picks up bug ticket: New -> In Progress -> In Review
    await moveTicket(devUser.id, bugTicket.id, { targetColumnId: colInProgress.id });
    await moveTicket(devUser.id, bugTicket.id, { targetColumnId: colInReview.id });

    // Tester CAN pull from In Review -> QA
    const testerQA = await moveTicket(testerUser.id, bugTicket.id, {
      targetColumnId: colQA.id,
    });
    expect(testerQA.columnId).toBe(colQA.id);

    // Tester CAN reject from QA back to In Progress (rejection / defect found)
    const testerReject = await moveTicket(testerUser.id, bugTicket.id, {
      targetColumnId: colInProgress.id,
    });
    expect(testerReject.columnId).toBe(colInProgress.id);

    // Dev fixes defect, resubmits: In Progress -> In Review -> QA
    await moveTicket(devUser.id, bugTicket.id, { targetColumnId: colInReview.id });
    await moveTicket(devUser.id, bugTicket.id, { targetColumnId: colQA.id });

    // Tester CAN sign off QA -> Done
    const testerDone = await moveTicket(testerUser.id, bugTicket.id, {
      targetColumnId: colDone.id,
    });
    expect(testerDone.columnId).toBe(colDone.id);

    // --- LEAD & ADMIN OVERRIDES ---
    // Lead can move any ticket anywhere (e.g. from Backlog directly to Done or QA)
    const backlogTicket = await createTicket(adminUser.id, board.id, {
      title: "Hotfix: Security vulnerability patch",
      columnId: colBacklog.id,
    });

    const leadBypass = await moveTicket(leadUser.id, backlogTicket.id, {
      targetColumnId: colDone.id,
    });
    expect(leadBypass.columnId).toBe(colDone.id);

    // Admin can move any ticket anywhere
    const adminMove = await moveTicket(adminUser.id, backlogTicket.id, {
      targetColumnId: colQA.id,
    });
    expect(adminMove.columnId).toBe(colQA.id);
  });

  it("rejects unauthorized sub-role moves with 403 Forbidden via HTTP route", async () => {
    const devUser = (
      await registerUser({
        email: `http-dev-${Date.now()}@example.org`,
        password: "Password123!",
        name: "HTTP Developer",
      })
    ).user;

    const testerUser = (
      await registerUser({
        email: `http-qa-${Date.now()}@example.org`,
        password: "Password123!",
        name: "HTTP QA Tester",
      })
    ).user;

    const adminUser = (
      await registerUser({
        email: `http-admin-${Date.now()}@example.org`,
        password: "Password123!",
        name: "HTTP Admin",
      })
    ).user;

    const org = await createOrg(adminUser.id, { name: "HTTP Org" });
    const team = await createTeam(adminUser.id, org.id, { name: "HTTP Team" });

    await addTeamMember(adminUser.id, team.id, {
      userId: devUser.id,
      role: "member",
      subRole: "developer",
    });
    await addTeamMember(adminUser.id, team.id, {
      userId: testerUser.id,
      role: "member",
      subRole: "tester",
    });

    const project = await createProject(adminUser.id, team.id, {
      name: "HTTP Project",
      key: "HTTP",
    });

    const board = await createBoard(adminUser.id, project.id, {
      name: "HTTP Board",
      columns: [
        { name: "Backlog" },
        { name: "In Progress" },
        { name: "QA" },
        { name: "Done" },
      ],
    });

    const boardData = await getBoardWithDetails(adminUser.id, board.id);
    const [colBacklog, colInProgress, colQA, colDone] = boardData.columns;

    const devSession = await createSession(devUser.id);
    const testerSession = await createSession(testerUser.id);

    const ticketInQA = await createTicket(adminUser.id, board.id, {
      title: "Task waiting in QA",
      columnId: colQA.id,
    });

    // Developer tries to move QA -> Done via HTTP POST /api/tickets/[id]/move
    const devReq = new NextRequest(`http://localhost:3000/api/tickets/${ticketInQA.id}/move`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${devSession.id}`,
        "x-csrf-token": devSession.csrfToken,
      },
      body: JSON.stringify({ targetColumnId: colDone.id }),
    });

    const devRes = await moveTicketRoute(devReq, {
      params: Promise.resolve({ ticketId: ticketInQA.id }),
    });
    expect(devRes.status).toBe(403);
    const devData = await devRes.json();
    expect(devData.error).toMatch(/Developers cannot move tickets directly to "Done"/i);

    // Tester tries to move Backlog -> In Progress via HTTP POST
    const backlogTicket = await createTicket(adminUser.id, board.id, {
      title: "Task in backlog",
      columnId: colBacklog.id,
    });

    const testerReq = new NextRequest(`http://localhost:3000/api/tickets/${backlogTicket.id}/move`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${testerSession.id}`,
        "x-csrf-token": testerSession.csrfToken,
      },
      body: JSON.stringify({ targetColumnId: colInProgress.id }),
    });

    const testerRes = await moveTicketRoute(testerReq, {
      params: Promise.resolve({ ticketId: backlogTicket.id }),
    });
    expect(testerRes.status).toBe(403);
    const testerData = await testerRes.json();
    expect(testerData.error).toMatch(/Testers cannot move tickets from.*to "In Progress"/i);
  });
});