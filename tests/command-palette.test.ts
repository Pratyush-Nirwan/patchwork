import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db, ensureMigrated } from "@/db";
import { orgs, teams, users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import {
  createOrg,
  createTeam,
  addTeamMember,
  createProject,
  createBoard,
  getBoardWithDetails,
} from "@/lib/hierarchy";
import { createTicket, getColumnStage } from "@/lib/tickets";
import { searchWorkspaceScoped } from "@/lib/search";
import {
  buildCommandNameGhostHint,
  buildSlashGhostHint,
  parseSearchQuery,
  parseSlashCommand,
} from "@/lib/commands/parser";
import {
  COMMAND_REGISTRY,
  filterCommandsByQuery,
  findCommandDefinition,
} from "@/lib/commands/registry";
import {
  detectShortcutConflict,
  formatShortcut,
  getDefaultShortcutMap,
  normalizeShortcutCombo,
} from "@/lib/shortcuts";
import { POST as executeCommandPost } from "@/app/api/commands/execute/route";

describe("Command Palette: parser, shortcuts, registry, search & server execution", () => {
  let adminUser: { id: string; email: string };
  let viewerUser: { id: string; email: string };
  let outsiderUser: { id: string; email: string };
  let adminCookie: string;
  let adminCsrf: string;
  let viewerCookie: string;
  let viewerCsrf: string;
  let orgId: string;
  let teamId: string;
  let boardId: string;
  let colTodoId: string;
  let colInProgressId: string;
  let ticketKey: string;
  let ticketId: string;

  beforeAll(async () => {
    await ensureMigrated();
    const ts = Date.now();
    const [uAdmin] = await db
      .insert(users)
      .values({
        email: `cp-admin-${ts}@example.com`,
        name: "CP Admin",
        passwordHash: "test-hash",
      })
      .returning();
    adminUser = uAdmin;

    const [uViewer] = await db
      .insert(users)
      .values({
        email: `cp-viewer-${ts}@example.com`,
        name: "CP Viewer",
        passwordHash: "test-hash",
      })
      .returning();
    viewerUser = uViewer;

    const [uOutsider] = await db
      .insert(users)
      .values({
        email: `cp-outsider-${ts}@example.com`,
        name: "CP Outsider",
        passwordHash: "test-hash",
      })
      .returning();
    outsiderUser = uOutsider;

    const org = await createOrg(adminUser.id, { name: `CP Org ${ts}` });
    orgId = org.id;
    const team = await createTeam(adminUser.id, orgId, { name: "Platform Core" });
    teamId = team.id;
    await addTeamMember(adminUser.id, teamId, {
      email: viewerUser.email,
      role: "viewer",
    });

    const project = await createProject(adminUser.id, teamId, {
      name: "Telemetry",
      key: "CP",
    });
    const board = await createBoard(adminUser.id, project.id, {
      name: "Sprint Board",
    });
    boardId = board.id;

    const initialBoard = await getBoardWithDetails(adminUser.id, boardId);
    colTodoId = initialBoard.columns[0]!.id;
    colInProgressId = initialBoard.columns.find((c) => c.name === "In Progress")!.id;

    const ticket = await createTicket(adminUser.id, boardId, {
      columnId: colTodoId,
      title: "Investigate websocket reconnection jitter",
      priority: "high",
      labels: ["infra", "bug"],
    });
    ticketKey = ticket.key;
    ticketId = ticket.id;

    const adminSess = await createSession(adminUser.id);
    adminCookie = `patchwork_session=${adminSess.id}`;
    adminCsrf = adminSess.csrfToken;

    const viewerSess = await createSession(viewerUser.id);
    viewerCookie = `patchwork_session=${viewerSess.id}`;
    viewerCsrf = viewerSess.csrfToken;
  });

  afterAll(async () => {
    if (orgId) {
      await db.delete(orgs).where(eq(orgs.id, orgId));
    }
    if (teamId) {
      await db.delete(teams).where(eq(teams.id, teamId));
    }
  });

  it("parses slash commands with quoted arguments and flags", () => {
    const parsed = parseSlashCommand('/new "Fix login race" --priority urgent --label bug');
    expect(parsed.isCommand).toBe(true);
    if (!parsed.isCommand) return;
    expect(parsed.commandName).toBe("new");
    expect(parsed.positional).toEqual(["Fix login race"]);
    expect(parsed.flags).toEqual({ priority: "urgent", label: "bug" });
  });

  it("parses search filter tokens alongside text queries", () => {
    const tokens = parseSearchQuery('in:CP priority:high label:infra assignee:me jitter');
    expect(tokens).toEqual({
      inScope: "CP",
      priority: "high",
      label: "infra",
      assignee: "me",
      textQuery: "jitter",
    });
  });

  it("formats OS shortcuts and detects conflicts", () => {
    expect(formatShortcut("mod+k", false)).toBe("Ctrl+K");
    expect(formatShortcut("mod+k", true)).toBe("⌘K");
    expect(normalizeShortcutCombo("Ctrl+Shift+P")).toBe("mod+shift+p");

    const map = getDefaultShortcutMap();
    expect(detectShortcutConflict("newTicket", "mod+k", map)).toBe("openPalette");
    expect(detectShortcutConflict("newTicket", "mod+j", map)).toBeNull();
  });

  it("filters command registry by role", () => {
    expect(findCommandDefinition("mv")?.name).toBe("move");
    const viewerCmds = filterCommandsByQuery("", "viewer").map((c) => c.name);
    expect(viewerCmds).toContain("help");
    expect(viewerCmds).toContain("go");
    expect(viewerCmds).not.toContain("new");
    expect(viewerCmds).not.toContain("system");

    const adminCmds = filterCommandsByQuery("", "admin").map((c) => c.name);
    expect(adminCmds).toContain("system");
    expect(adminCmds).toContain("column");
  });

  it("scopes search results to accessible teams and excludes unauthorized users", async () => {
    const allowed = await searchWorkspaceScoped(viewerUser.id, "priority:high jitter", {
      orgId,
    });
    expect(allowed.groups.tickets.some((t) => t.ticketKey === ticketKey)).toBe(true);

    const boardHit = await searchWorkspaceScoped(viewerUser.id, "Sprint", { orgId });
    expect(boardHit.groups.boards.some((b) => b.id === boardId)).toBe(true);

    const outsider = await searchWorkspaceScoped(outsiderUser.id, "jitter", { orgId });
    expect(outsider.results).toHaveLength(0);
    expect(outsider.groups.boards).toHaveLength(0);
  });

  it("enforces server-side RBAC on /api/commands/execute", async () => {
    const viewerReq = new NextRequest("http://localhost:3000/api/commands/execute", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: viewerCookie,
        "x-csrf-token": viewerCsrf,
      },
      body: JSON.stringify({
        command: "priority",
        positional: [ticketKey, "urgent"],
        context: { orgId, teamId, boardId },
      }),
    });
    const viewerRes = await executeCommandPost(viewerReq);
    expect(viewerRes.status).toBe(403);
  });

  it("executes /move, /priority, /comment, /archive and excludes archived tickets from board & default search", async () => {
    const moveReq = new NextRequest("http://localhost:3000/api/commands/execute", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
        "x-csrf-token": adminCsrf,
      },
      body: JSON.stringify({
        command: "move",
        positional: [ticketKey, "In Progress"],
        context: { orgId, teamId, boardId },
      }),
    });
    const moveRes = await executeCommandPost(moveReq);
    expect(moveRes.status).toBe(200);
    const moveData = await moveRes.json();
    expect(moveData.ticket.columnId).toBe(colInProgressId);

    const commentReq = new NextRequest("http://localhost:3000/api/commands/execute", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
        "x-csrf-token": adminCsrf,
      },
      body: JSON.stringify({
        command: "comment",
        positional: [ticketKey, "Checked logs on node 2"],
        context: { orgId, teamId, boardId },
      }),
    });
    const commentRes = await executeCommandPost(commentReq);
    expect(commentRes.status).toBe(200);

    const archiveReq = new NextRequest("http://localhost:3000/api/commands/execute", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
        "x-csrf-token": adminCsrf,
      },
      body: JSON.stringify({
        command: "archive",
        positional: [ticketKey],
        context: { orgId, teamId, boardId },
      }),
    });
    const archiveRes = await executeCommandPost(archiveReq);
    expect(archiveRes.status).toBe(200);

    const boardDetails = await getBoardWithDetails(adminUser.id, boardId);
    expect(boardDetails.tickets.some((t) => t.id === ticketId)).toBe(false);

    const defaultSearch = await searchWorkspaceScoped(adminUser.id, "jitter", { orgId });
    expect(defaultSearch.results.some((r) => r.ticketId === ticketId)).toBe(false);

    const archivedSearch = await searchWorkspaceScoped(
      adminUser.id,
      "status:archived jitter",
      { orgId }
    );
    expect(archivedSearch.results.some((r) => r.ticketId === ticketId)).toBe(true);
  });

  it("defaults new tickets without --column to the 'new' stage column instead of 'Backlog'", async () => {
    const created = await createTicket(adminUser.id, boardId, {
      title: "Default column check",
    });
    const boardDetails = await getBoardWithDetails(adminUser.id, boardId);
    const newCol = boardDetails.columns.find((c) => getColumnStage(c.name) === "new");
    expect(newCol).toBeDefined();
    expect(created.columnId).toBe(newCol!.id);
  });

  it("ensures every command in COMMAND_REGISTRY has required metadata and schema-driven ghost hints", () => {
    for (const cmd of COMMAND_REGISTRY) {
      expect(cmd.name.length).toBeGreaterThan(0);
      expect(cmd.usage.startsWith(`/${cmd.name}`)).toBe(true);

      const parsed = parseSlashCommand(`/${cmd.name} `, cmd);
      expect(parsed.isCommand).toBe(true);
      if (!parsed.isCommand) continue;

      const hint = buildSlashGhostHint(cmd, parsed);
      const expectedArgs = cmd.args.map((arg) => arg.label || arg.name);
      const expectedOpts = (cmd.options || []).map((opt) => `${opt.key}:`);
      const combined = [hint.activeSegment, ...hint.remainingSegments].filter(Boolean);
      expect(combined).toEqual([...expectedArgs, ...expectedOpts]);
      expect(hint.readyToRun).toBe(cmd.args.every((a) => !a.required));
    }
  });

  it("parses key:value options in any order, quoted strings, escaped quotes, extra spaces, and detects errors", () => {
    const newCmd = findCommandDefinition("new")!;

    // Key:value options in arbitrary order + quoted title with escaped quotes + extra spaces
    const parsed = parseSlashCommand(
      '/new   label:bug   "Fix \\"login\\"   modal"   priority:urgent   assignee:@alex ',
      newCmd
    );
    expect(parsed.isCommand).toBe(true);
    if (!parsed.isCommand) return;
    expect(parsed.commandName).toBe("new");
    expect(parsed.positional).toEqual(['Fix "login"   modal']);
    expect(parsed.flags).toEqual({ label: "bug", priority: "urgent", assignee: "@alex" });
    expect(parsed.unknownKey).toBeUndefined();
    expect(parsed.duplicateKeys).toEqual([]);
    expect(parsed.overlongValue).toBe(false);

    // Active option detection when typing priority:
    const activeOpt = parseSlashCommand('/new "Fix" priority:', newCmd);
    expect(activeOpt.isCommand).toBe(true);
    if (activeOpt.isCommand) {
      expect(activeOpt.activeOption?.key).toBe("priority");
      expect(activeOpt.activeOption?.value).toBe("");
      const hint = buildSlashGhostHint(newCmd, activeOpt);
      expect(hint.activeSegment).toContain("level");
    }

    // Unknown option key with Levenshtein suggestion
    const typo = parseSlashCommand('/new "Fix" priorty:high', newCmd);
    expect(typo.isCommand).toBe(true);
    if (typo.isCommand) {
      expect(typo.unknownKey?.key).toBe("priorty");
      expect(typo.unknownKey?.suggestion).toBe("priority");
    }

    // Duplicate keys
    const dup = parseSlashCommand('/new "Fix" priority:low priority:high', newCmd);
    expect(dup.isCommand).toBe(true);
    if (dup.isCommand) {
      expect(dup.duplicateKeys).toContain("priority");
    }

    // Overlong value (>500 chars)
    const longVal = "a".repeat(505);
    const overlong = parseSlashCommand(`/new "Fix" priority:${longVal}`, newCmd);
    expect(overlong.isCommand).toBe(true);
    if (overlong.isCommand) {
      expect(overlong.overlongValue).toBe(true);
    }
  });

  it("tracks active argument and remaining ghost hints step-by-step for positional commands", () => {
    const moveCmd = findCommandDefinition("move")!;

    const step1 = parseSlashCommand("/move ", moveCmd);
    expect(step1.isCommand).toBe(true);
    if (step1.isCommand) {
      expect(step1.positional).toEqual([]);
      const h1 = buildSlashGhostHint(moveCmd, step1);
      expect(h1.activeSegment).toBe("ticket");
      expect(h1.remainingSegments).toEqual(["column"]);
      expect(h1.readyToRun).toBe(false);
    }

    const step2 = parseSlashCommand("/move PAY-12 ", moveCmd);
    expect(step2.isCommand).toBe(true);
    if (step2.isCommand) {
      expect(step2.positional).toEqual(["PAY-12"]);
      const h2 = buildSlashGhostHint(moveCmd, step2);
      expect(h2.activeSegment).toBe("column");
      expect(h2.remainingSegments).toEqual([]);
      expect(h2.readyToRun).toBe(false);
    }

    const step3 = parseSlashCommand('/move PAY-12 "In Progress"', moveCmd);
    expect(step3.isCommand).toBe(true);
    if (step3.isCommand) {
      const h3 = buildSlashGhostHint(moveCmd, step3);
      expect(h3.activeSegment).toBe("");
      expect(h3.remainingSegments).toEqual([]);
      expect(h3.readyToRun).toBe(true);
    }
  });

  it("builds inline command-name completion ghost hints", () => {
    const moveCmd = findCommandDefinition("move")!;
    const ghost = buildCommandNameGhostHint("mo", moveCmd);
    expect(ghost.completion).toBe("ve");
    expect(ghost.remainingArgs).toEqual(["ticket", "column"]);

    const exact = buildCommandNameGhostHint("move", moveCmd);
    expect(exact.completion).toBe("");
    expect(exact.remainingArgs).toEqual(["ticket", "column"]);
  });
});
