import crypto from "crypto";
import { db, pool } from "@/db";
import { domainEvents } from "@/db/schema";

export type DomainEventType =
  | "ticket.created"
  | "ticket.updated"
  | "ticket.moved"
  | "ticket.archived"
  | "ticket.deleted"
  | "comment.created"
  | "comment.edited"
  | "attachment.added"
  | "attachment.removed"
  | "link.added"
  | "link.removed"
  | "watcher.added"
  | "watcher.removed";

export type DbOrTx = Pick<typeof db, "insert" | "select" | "update" | "delete">;

export interface EmitDomainEventInput {
  eventType: DomainEventType;
  aggregateType?: string;
  aggregateId: string;
  orgId: string;
  teamId: string;
  boardId: string;
  actorId?: string | null;
  idempotencyKey?: string;
  /**
   * Minimal metadata only (IDs, changed field names, column names, priority/label keys).
   * Never store full ticket descriptions, comment bodies, or secrets here.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Writes a domain event row into `domain_events` inside the caller's transaction.
 */
export async function emitDomainEvent(
  txOrDb: DbOrTx,
  input: EmitDomainEventInput
) {
  const idempotencyKey = input.idempotencyKey || crypto.randomUUID();
  const [row] = await txOrDb
    .insert(domainEvents)
    .values({
      eventType: input.eventType,
      aggregateType: input.aggregateType || "ticket",
      aggregateId: input.aggregateId,
      orgId: input.orgId,
      teamId: input.teamId,
      boardId: input.boardId,
      actorId: input.actorId ?? null,
      idempotencyKey,
      metadata: input.metadata ?? {},
    })
    .onConflictDoNothing({ target: domainEvents.idempotencyKey })
    .returning();

  return row ?? null;
}

/**
 * Best-effort wake-up signal for the background worker after a transaction commits.
 * The worker also polls on a fallback interval, so missed NOTIFYs never drop events.
 */
export async function notifyDomainEventWorker(eventId?: string): Promise<void> {
  try {
    await pool.query("SELECT pg_notify('patchwork_domain_events', $1)", [
      eventId || "wake",
    ]);
  } catch {
    // Non-fatal: worker polling fallback handles delivery
  }
}
