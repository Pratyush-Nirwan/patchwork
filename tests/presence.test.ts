import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, ensureMigrated } from "@/db";
import {
  users,
  orgs,
  orgMembers,
  teams,
  teamMembers,
  userNotificationPreferences,
} from "@/db/schema";
import { setSystemSetting, resetSystemSetting } from "@/lib/settings";
import { presenceHub, TYPING_EXPIRY_MS, VIEW_EXPIRY_MS } from "@/lib/presence";

describe("Step 7: Presence & Typing Indicators", () => {
  let orgId: string;
  let teamId: string;
  let aliceId: string;
  let bobId: string;
  let outsiderId: string;

  beforeAll(async () => {
    await ensureMigrated();
    const uid = crypto.randomUUID().slice(0, 8);
    const [a] = await db
      .insert(users)
      .values({ email: `pr-alice-${uid}@example.com`, name: "Alice PR", passwordHash: "hash" })
      .returning();
    const [b] = await db
      .insert(users)
      .values({ email: `pr-bob-${uid}@example.com`, name: "Bob PR", passwordHash: "hash" })
      .returning();
    const [out] = await db
      .insert(users)
      .values({ email: `pr-out-${uid}@example.com`, name: "Outsider PR", passwordHash: "hash" })
      .returning();
    aliceId = a.id;
    bobId = b.id;
    outsiderId = out.id;

    const [o] = await db
      .insert(orgs)
      .values({ name: `PR Org ${uid}`, slug: `pr-org-${uid}`, createdById: aliceId })
      .returning();
    orgId = o.id;
    await db.insert(orgMembers).values([
      { orgId, userId: aliceId, role: "admin" },
      { orgId, userId: bobId, role: "member" },
      { orgId, userId: outsiderId, role: "member" },
    ]);

    const [t] = await db
      .insert(teams)
      .values({ orgId, name: "PRTeam", slug: `pr-team-${uid}` })
      .returning();
    teamId = t.id;
    await db.insert(teamMembers).values([
      { teamId, userId: aliceId, role: "lead" },
      { teamId, userId: bobId, role: "member" },
    ]);
  });

  afterAll(async () => {
    await resetSystemSetting("notifications").catch(() => undefined);
  });

  it("deduplicates multiple tabs per user, handles leave, and expires stale viewers/typers", async () => {
    const ticketId = crypto.randomUUID();
    await presenceHub.publishHeartbeat({
      ticketId,
      orgId,
      teamId,
      userId: aliceId,
      name: "Alice PR",
      tabId: "tab-1",
      state: "view",
    });
    await presenceHub.publishHeartbeat({
      ticketId,
      orgId,
      teamId,
      userId: aliceId,
      name: "Alice PR",
      tabId: "tab-2",
      state: "typing",
    });

    let snap = presenceHub.getSnapshot(ticketId);
    expect(snap.viewers.length).toBe(1);
    expect(snap.typers.length).toBe(1);

    // Closing tab-1 keeps Alice visible via tab-2
    await presenceHub.publishHeartbeat({
      ticketId,
      orgId,
      teamId,
      userId: aliceId,
      name: "Alice PR",
      tabId: "tab-1",
      state: "leave",
    });
    snap = presenceHub.getSnapshot(ticketId);
    expect(snap.viewers.length).toBe(1);

    // Typing expires after TYPING_EXPIRY_MS
    const futureTyping = Date.now() + TYPING_EXPIRY_MS + 100;
    expect(presenceHub.getSnapshot(ticketId, futureTyping).typers.length).toBe(0);

    // View expires and sweeps after VIEW_EXPIRY_MS
    const futureView = Date.now() + VIEW_EXPIRY_MS + 100;
    const swept = presenceHub.sweepExpired(futureView);
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(presenceHub.getSnapshot(ticketId, futureView).viewers.length).toBe(0);
  });

  it("enforces ticket access, user privacy toggle, and org-level presence toggle", async () => {
    const ticketId = crypto.randomUUID();

    // Outsider cannot appear
    await presenceHub.publishHeartbeat({
      ticketId,
      orgId,
      teamId,
      userId: outsiderId,
      name: "Outsider PR",
      tabId: "t1",
      state: "view",
    });
    expect(presenceHub.getSnapshot(ticketId).viewers.length).toBe(0);

    // User privacy toggle off
    await db
      .insert(userNotificationPreferences)
      .values({ userId: bobId, presenceEnabled: false })
      .onConflictDoUpdate({
        target: userNotificationPreferences.userId,
        set: { presenceEnabled: false },
      });
    await presenceHub.publishHeartbeat({
      ticketId,
      orgId,
      teamId,
      userId: bobId,
      name: "Bob PR",
      tabId: "t1",
      state: "view",
    });
    expect(presenceHub.getSnapshot(ticketId).viewers.length).toBe(0);

    // Org toggle off
    await setSystemSetting("notifications", { presenceEnabled: false });
    const snap = await presenceHub.publishHeartbeat({
      ticketId,
      orgId,
      teamId,
      userId: aliceId,
      name: "Alice PR",
      tabId: "t1",
      state: "view",
    });
    expect(snap.viewers.length).toBe(0);
    await setSystemSetting("notifications", { presenceEnabled: true });
  });

  it("handles 50 concurrent viewers on one ticket without lag", () => {
    const ticketId = crypto.randomUUID();
    const start = performance.now();
    for (let i = 0; i < 50; i++) {
      presenceHub.applyLocalEvent({
        ticketId,
        userId: `user-${i}`,
        name: `User ${i}`,
        tabId: `tab-${i}`,
        state: i < 5 ? "typing" : "view",
      });
    }
    const snap = presenceHub.getSnapshot(ticketId);
    const elapsedMs = performance.now() - start;
    expect(snap.viewers.length).toBe(50);
    expect(snap.typers.length).toBe(5);
    expect(elapsedMs).toBeLessThan(100);
    presenceHub.sweepExpired(Date.now() + VIEW_EXPIRY_MS + 100);
  });
});
