import crypto from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { db, ensureMigrated } from "@/db";
import {
  users,
  orgs,
  orgMembers,
  teams,
  teamMembers,
  projects,
  boards,
  columns,
  userNotificationPreferences,
} from "@/db/schema";
import { createTicket, updateTicket } from "@/lib/tickets";
import { addComment } from "@/lib/comments";
import {
  getTicketWatchStatus,
  listTicketWatchers,
  pruneWatchersForUser,
  setTicketMute,
  unwatchTicket,
  watchTicket,
} from "@/lib/watchers";
import { parseSearchQuery } from "@/lib/commands/parser";
import { searchWorkspaceScoped } from "@/lib/search";
import { findCommandDefinition, isRoleAllowedForCommand } from "@/lib/commands/registry";

describe("Step 2: Ticket Watchers & Commands", () => {
  let orgId: string;
  let teamId: string;
  let boardId: string;
  let creatorId: string;
  let memberId: string;
  let viewerId: string;
  let outsiderId: string;

  beforeAll(async () => {
    await ensureMigrated();
    const uid = crypto.randomUUID().slice(0, 8);

    const mkUser = async (tag: string) => {
      const [u] = await db
        .insert(users)
        .values({
          email: `w-${tag}-${uid}@example.com`,
          name: `Watcher ${tag} ${uid}`,
          passwordHash: "hash",
        })
        .returning();
      return u.id;
    };

    creatorId = await mkUser("creator");
    memberId = await mkUser("member");
    viewerId = await mkUser("viewer");
    outsiderId = await mkUser("outsider");

    const [o] = await db
      .insert(orgs)
      .values({ name: `W Org ${uid}`, slug: `w-org-${uid}`, createdById: creatorId })
      .returning();
    orgId = o.id;
    await db.insert(orgMembers).values([
      { orgId, userId: creatorId, role: "admin" },
      { orgId, userId: memberId, role: "member" },
      { orgId, userId: viewerId, role: "member" },
      { orgId, userId: outsiderId, role: "member" },
    ]);

    const [t] = await db
      .insert(teams)
      .values({ orgId, name: "WatchTeam", slug: `w-team-${uid}` })
      .returning();
    teamId = t.id;
    await db.insert(teamMembers).values([
      { teamId, userId: creatorId, role: "lead" },
      { teamId, userId: memberId, role: "member" },
      { teamId, userId: viewerId, role: "viewer" },
    ]);

    const [p] = await db
      .insert(projects)
      .values({ orgId, teamId, name: "WatchProj", key: `W${uid.slice(0, 3).toUpperCase()}` })
      .returning();
    const [b] = await db
      .insert(boards)
      .values({ orgId, teamId, projectId: p.id, name: "Main" })
      .returning();
    boardId = b.id;
    await db.insert(columns).values({ boardId, name: "Backlog", position: 0 });
  });

  it("auto-watches creator, assignee, commenter and respects explicit unwatch", async () => {
    const ticket = await createTicket(creatorId, boardId, {
      title: "Auto-watch behavior",
      assigneeId: memberId,
    });

    const creatorStatus = await getTicketWatchStatus(creatorId, ticket.id);
    expect(creatorStatus.watching).toBe(true);
    expect(creatorStatus.watcherCount).toBe(2);

    // Member unwatches; commenting should NOT re-watch
    await unwatchTicket(memberId, ticket.id);
    expect((await getTicketWatchStatus(memberId, ticket.id)).watching).toBe(false);

    await addComment(memberId, ticket.id, { body: "Commenting after unwatch" });
    expect((await getTicketWatchStatus(memberId, ticket.id)).watching).toBe(false);

    // Unassign then re-assign DOES re-watch
    await updateTicket(creatorId, ticket.id, { assigneeId: null });
    await updateTicket(creatorId, ticket.id, { assigneeId: memberId });
    expect((await getTicketWatchStatus(memberId, ticket.id)).watching).toBe(true);
  });

  it("respects user auto-watch preference toggles", async () => {
    await db
      .insert(userNotificationPreferences)
      .values({ userId: viewerId, autoWatchCreator: false })
      .onConflictDoNothing();

    const ticket = await createTicket(creatorId, boardId, {
      title: "Pref toggle ticket",
    });

    // Viewer manually watches and mutes
    const w = await watchTicket(viewerId, ticket.id);
    expect(w.watching).toBe(true);
    const muted = await setTicketMute(viewerId, ticket.id, true);
    expect(muted.watching).toBe(true);
    expect(muted.muted).toBe(true);
  });

  it("blocks unauthorized users from watching or listing watchers and prunes on access loss", async () => {
    const ticket = await createTicket(creatorId, boardId, {
      title: "Access scoped watch",
    });

    await expect(watchTicket(outsiderId, ticket.id)).rejects.toThrow();
    await expect(listTicketWatchers(outsiderId, ticket.id)).rejects.toThrow();

    await watchTicket(viewerId, ticket.id);
    expect((await listTicketWatchers(creatorId, ticket.id)).watchers.some((w) => w.userId === viewerId)).toBe(true);

    // Remove viewer from team and prune
    await db
      .delete(teamMembers)
      .where(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (await import("drizzle-orm")).and(
          (await import("drizzle-orm")).eq(teamMembers.teamId, teamId),
          (await import("drizzle-orm")).eq(teamMembers.userId, viewerId)
        )
      );
    await pruneWatchersForUser(viewerId, teamId);
    expect((await listTicketWatchers(creatorId, ticket.id)).watchers.some((w) => w.userId === viewerId)).toBe(false);

    // Restore viewer membership for subsequent tests
    await db.insert(teamMembers).values({ teamId, userId: viewerId, role: "viewer" }).onConflictDoNothing();
  });

  it("supports watching:me search filter token and /watch, /unwatch, /mute command registry roles", async () => {
    const parsed = parseSearchQuery("watching:me priority:high bug");
    expect(parsed.watching).toBe("me");
    expect(parsed.priority).toBe("high");
    expect(parsed.textQuery).toBe("bug");

    const ticket = await createTicket(creatorId, boardId, {
      title: "UniqueWatchSearchToken991",
      priority: "high",
    });
    const res = await searchWorkspaceScoped(creatorId, "watching:me UniqueWatchSearchToken991", { orgId });
    expect(res.groups.tickets.some((t) => t.ticketId === ticket.id)).toBe(true);

    const outsiderRes = await searchWorkspaceScoped(memberId, "watching:me UniqueWatchSearchToken991", { orgId });
    expect(outsiderRes.groups.tickets.some((t) => t.ticketId === ticket.id)).toBe(false);

    for (const cmdName of ["watch", "unwatch", "mute"]) {
      const def = findCommandDefinition(cmdName);
      expect(def).toBeDefined();
      expect(isRoleAllowedForCommand("viewer", def!.minRole)).toBe(true);
      expect(isRoleAllowedForCommand("member", def!.minRole)).toBe(true);
      expect(isRoleAllowedForCommand("lead", def!.minRole)).toBe(true);
      expect(isRoleAllowedForCommand("admin", def!.minRole)).toBe(true);
    }
  });
});
