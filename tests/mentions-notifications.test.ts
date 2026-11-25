import crypto from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
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
  notifications,
} from "@/db/schema";
import { createTicket, updateTicket, moveTicket } from "@/lib/tickets";
import { addComment, editComment } from "@/lib/comments";
import { validateAndSanitizeMentions } from "@/lib/mentions";
import {
  archiveNotification,
  cleanupNotificationRetention,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications";
import { backgroundWorker } from "@/lib/worker";

describe("Step 3: Mentions & Notification Core", () => {
  let orgId: string;
  let teamId: string;
  let boardId: string;
  let col2Id: string;
  let aliceId: string;
  let bobId: string;
  let carolId: string;
  let outsiderId: string;

  beforeAll(async () => {
    await ensureMigrated();
    const uid = crypto.randomUUID().slice(0, 8);
    const mkUser = async (name: string, tag: string) => {
      const [u] = await db
        .insert(users)
        .values({
          email: `mn-${tag}-${uid}@example.com`,
          name,
          passwordHash: "hash",
        })
        .returning();
      return u.id;
    };

    aliceId = await mkUser("Alice", "alice");
    bobId = await mkUser("Bob", "bob");
    carolId = await mkUser("Carol", "carol");
    outsiderId = await mkUser("Outsider", "outsider");

    const [o] = await db
      .insert(orgs)
      .values({ name: `MN Org ${uid}`, slug: `mn-org-${uid}`, createdById: aliceId })
      .returning();
    orgId = o.id;
    await db.insert(orgMembers).values([
      { orgId, userId: aliceId, role: "admin" },
      { orgId, userId: bobId, role: "member" },
      { orgId, userId: carolId, role: "member" },
      { orgId, userId: outsiderId, role: "member" },
    ]);

    const [t] = await db
      .insert(teams)
      .values({ orgId, name: "MNTeam", slug: `mn-team-${uid}` })
      .returning();
    teamId = t.id;
    await db.insert(teamMembers).values([
      { teamId, userId: aliceId, role: "lead" },
      { teamId, userId: bobId, role: "member" },
      { teamId, userId: carolId, role: "member" },
    ]);

    const [p] = await db
      .insert(projects)
      .values({ orgId, teamId, name: "MNProj", key: `MN${uid.slice(0, 3).toUpperCase()}` })
      .returning();
    const [b] = await db
      .insert(boards)
      .values({ orgId, teamId, projectId: p.id, name: "Board" })
      .returning();
    boardId = b.id;
    await db.insert(columns).values({ boardId, name: "Backlog", position: 0 });
    const [c2] = await db.insert(columns).values({ boardId, name: "In Progress", position: 1 }).returning();
    col2Id = c2.id;

    // Ensure notification handler is registered
    await import("@/lib/notifications");
  });

  it("ignores forged/unauthorized mentions and skips code blocks, inline code, and quotes", async () => {
    const md = [
      `Hello @[Bob](mention:${bobId}) and @[Outsider](mention:${outsiderId})`,
      `Inline \`@[Carol](mention:${carolId})\``,
      "> Quoted @[Carol](mention:" + carolId + ")",
      "```",
      `@[Carol](mention:${carolId})`,
      "```",
    ].join("\n");

    const res = await validateAndSanitizeMentions(md, { orgId, teamId });
    expect(res.validUserIds).toEqual([bobId]);
    expect(res.unauthorizedCount).toBe(1);
    expect(res.sanitizedMarkdown).toContain(`@[Bob](mention:${bobId})`);
    expect(res.sanitizedMarkdown).not.toContain(`mention:${outsiderId}`);
    expect(res.sanitizedMarkdown).toContain("@Outsider");
  });

  it("notifies mentioned users, skips self, and edit only notifies newly added mentions", async () => {
    const ticket = await createTicket(aliceId, boardId, {
      title: "Mention flow ticket",
    });

    const comment = await addComment(aliceId, ticket.id, {
      body: `Hey @[Bob](mention:${bobId}) and @[Alice](mention:${aliceId})`,
    });
    expect(comment.mentionWarning).toBeUndefined();

    await backgroundWorker.processDomainEventsBatch(50);

    const bobList = await listNotifications(bobId, { tab: "mentions" });
    expect(bobList.items.some((n) => n.ticketId === ticket.id && n.type === "mention")).toBe(true);

    // Self mention never notifies Alice
    const aliceList = await listNotifications(aliceId, { tab: "mentions" });
    expect(aliceList.items.some((n) => n.ticketId === ticket.id)).toBe(false);

    // Edit comment: keep Bob, add Carol -> only Carol gets a new mention notification
    await editComment(aliceId, ticket.id, comment.id, {
      body: `Hey @[Bob](mention:${bobId}) and @[Carol](mention:${carolId})`,
    });
    await backgroundWorker.processDomainEventsBatch(50);

    const bobMentions = (await listNotifications(bobId, { tab: "mentions" })).items.filter(
      (n) => n.ticketId === ticket.id
    );
    expect(bobMentions.length).toBe(1);

    const carolMentions = (await listNotifications(carolId, { tab: "mentions" })).items.filter(
      (n) => n.ticketId === ticket.id
    );
    expect(carolMentions.length).toBe(1);
  });

  it("coalesces watched updates within 5 minutes and redacts after access loss", async () => {
    const ticket = await createTicket(aliceId, boardId, {
      title: "Coalesce & redact ticket",
    });
    // Carol watches ticket
    const { watchTicket } = await import("@/lib/watchers");
    await watchTicket(carolId, ticket.id);

    await updateTicket(aliceId, ticket.id, { priority: "high" });
    await moveTicket(aliceId, ticket.id, { targetColumnId: col2Id });
    await backgroundWorker.processDomainEventsBatch(50);

    const carolWatching = (await listNotifications(carolId, { tab: "watching" })).items.filter(
      (n) => n.ticketId === ticket.id
    );
    expect(carolWatching.length).toBe(1);
    expect(carolWatching[0].count).toBe(2);
    expect(carolWatching[0].redacted).toBe(false);

    // Revoke Carol's team access -> notification must redact on read
    await db
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, carolId)));

    const redactedList = await listNotifications(carolId, { tab: "watching" });
    const redactedItem = redactedList.items.find((n) => n.ticketId === ticket.id);
    expect(redactedItem).toBeDefined();
    expect(redactedItem!.redacted).toBe(true);
    expect(redactedItem!.ticketTitle).toBe("You no longer have access to this ticket");
    expect(redactedItem!.ticketKey).toBeNull();
    expect(redactedItem!.snippet).toBeNull();

    // Restore Carol
    await db.insert(teamMembers).values({ teamId, userId: carolId, role: "member" }).onConflictDoNothing();
  });

  it("supports read, unread, markAllRead, archive, and retention cleanup", async () => {
    const unreadBefore = await getUnreadNotificationCount(bobId);
    expect(unreadBefore).toBeGreaterThanOrEqual(1);

    const page1 = await listNotifications(bobId, { tab: "all", limit: 1 });
    expect(page1.items.length).toBe(1);

    const firstId = page1.items[0].id;
    await markNotificationRead(bobId, firstId, true);
    await markNotificationRead(bobId, firstId, false);
    await markAllNotificationsRead(bobId);
    expect(await getUnreadNotificationCount(bobId)).toBe(0);

    await archiveNotification(bobId, firstId);
    const afterArchive = await listNotifications(bobId, { tab: "all" });
    expect(afterArchive.items.some((n) => n.id === firstId)).toBe(false);

    await cleanupNotificationRetention();
  });
});
