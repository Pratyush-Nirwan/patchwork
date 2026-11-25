import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, ensureMigrated, pool } from "@/db";
import {
  users,
  orgs,
  orgMembers,
  teams,
  teamMembers,
  projects,
  boards,
  columns,
  domainEvents,
} from "@/db/schema";
import { createTicket, updateTicket, moveTicket, archiveTicket } from "@/lib/tickets";
import { addComment, editComment } from "@/lib/comments";
import { emitDomainEvent } from "@/lib/domain-events";
import { backgroundWorker, getWorkerHealthSnapshot } from "@/lib/worker";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

describe("Step 1: Domain Events & Worker Foundations", () => {
  let actorId: string;
  let orgId: string;
  let teamId: string;
  let boardId: string;
  let col1Id: string;
  let col2Id: string;

  beforeAll(async () => {
    await ensureMigrated();
    const uid = crypto.randomUUID().slice(0, 8);
    const [u] = await db
      .insert(users)
      .values({
        email: `de-actor-${uid}@example.com`,
        name: "Domain Event Tester",
        passwordHash: "hash",
      })
      .returning();
    actorId = u.id;

    const [o] = await db
      .insert(orgs)
      .values({ name: `DE Org ${uid}`, slug: `de-org-${uid}`, createdById: actorId })
      .returning();
    orgId = o.id;

    await db.insert(orgMembers).values({ orgId, userId: actorId, role: "admin" });

    const [t] = await db
      .insert(teams)
      .values({ orgId, name: "Core", slug: `core-${uid}` })
      .returning();
    teamId = t.id;
    await db.insert(teamMembers).values({ teamId, userId: actorId, role: "lead" });

    const [p] = await db
      .insert(projects)
      .values({ orgId, teamId, name: "App", key: `DE${uid.slice(0, 3).toUpperCase()}` })
      .returning();

    const [b] = await db
      .insert(boards)
      .values({ orgId, teamId, projectId: p.id, name: "Board" })
      .returning();
    boardId = b.id;

    const [c1] = await db
      .insert(columns)
      .values({ boardId, name: "Backlog", position: 0 })
      .returning();
    const [c2] = await db
      .insert(columns)
      .values({ boardId, name: "In Progress", position: 1 })
      .returning();
    col1Id = c1.id;
    col2Id = c2.id;
  });

  it("statically enforces emitDomainEvent inside db.transaction in all mutating ticket services", () => {
    const files = [
      "src/lib/tickets.ts",
      "src/lib/comments.ts",
      "src/lib/attachments.ts",
      "src/lib/links.ts",
    ];
    for (const rel of files) {
      const content = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      expect(content).toContain("emitDomainEvent(");
      expect(content).toContain("db.transaction(");
    }
  });

  it("emits domain_events atomically on ticket/comment mutations without storing full text", async () => {
    const longSecretDesc = "SENSITIVE_DESCRIPTION_BODY_SHOULD_NOT_BE_IN_EVENT_METADATA";
    const ticket = await createTicket(actorId, boardId, {
      title: "Transactional outbox test",
      description: longSecretDesc,
      priority: "high",
    });

    await updateTicket(actorId, ticket.id, {
      description: "UPDATED_FULL_DESCRIPTION_BODY",
      priority: "urgent",
    });

    await moveTicket(actorId, ticket.id, { targetColumnId: col2Id });
    const comment = await addComment(actorId, ticket.id, {
      body: "FULL_COMMENT_BODY_NOT_IN_DOMAIN_EVENTS",
    });
    await editComment(actorId, ticket.id, comment.id, {
      body: "EDITED_COMMENT_BODY_NOT_IN_DOMAIN_EVENTS",
    });
    await archiveTicket(actorId, ticket.id);

    const rows = await db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.aggregateId, ticket.id));

    const types = rows.map((r) => r.eventType);
    expect(types).toContain("ticket.created");
    expect(types).toContain("ticket.updated");
    expect(types).toContain("ticket.moved");
    expect(types).toContain("comment.created");
    expect(types).toContain("comment.edited");
    expect(types).toContain("ticket.archived");

    for (const r of rows) {
      const rawMeta = JSON.stringify(r.metadata);
      expect(rawMeta).not.toContain(longSecretDesc);
      expect(rawMeta).not.toContain("UPDATED_FULL_DESCRIPTION_BODY");
      expect(rawMeta).not.toContain("FULL_COMMENT_BODY_NOT_IN_DOMAIN_EVENTS");
      expect(rawMeta).not.toContain("EDITED_COMMENT_BODY_NOT_IN_DOMAIN_EVENTS");
    }
  });

  it("enforces idempotency_key uniqueness and processes events once under concurrent worker batches", async () => {
    const idemKey = `idem-${crypto.randomUUID()}`;
    const ticketId = crypto.randomUUID();

    const first = await emitDomainEvent(db, {
      eventType: "ticket.updated",
      aggregateId: ticketId,
      orgId,
      teamId,
      boardId,
      actorId,
      idempotencyKey: idemKey,
      metadata: { test: true },
    });
    const second = await emitDomainEvent(db, {
      eventType: "ticket.updated",
      aggregateId: ticketId,
      orgId,
      teamId,
      boardId,
      actorId,
      idempotencyKey: idemKey,
      metadata: { test: true },
    });
    expect(first).not.toBeNull();
    expect(second).toBeNull();

    let handled = 0;
    backgroundWorker.registerDomainEventHandler(async (ev) => {
      if (ev.idempotencyKey === idemKey) {
        handled += 1;
      }
    });

    const [a, b] = await Promise.all([
      backgroundWorker.processDomainEventsBatch(50),
      backgroundWorker.processDomainEventsBatch(50),
    ]);
    expect(a + b).toBeGreaterThanOrEqual(1);
    expect(handled).toBe(1);

    const health = await getWorkerHealthSnapshot();
    expect(health.queues.domainEvents).toBeDefined();
    expect(health.queues.emailOutbox).toBeDefined();
    expect(health.queues.webhookDeliveries).toBeDefined();
    await pool.query("DELETE FROM domain_events WHERE idempotency_key = $1", [idemKey]);
  });
});
