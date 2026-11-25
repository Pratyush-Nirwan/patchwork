import crypto from "crypto";
import { Client } from "pg";
import { pool } from "@/db";
import type { DomainEventType } from "./domain-events";

const WORKER_LOCK_ID = 92837465;
const MAX_ATTEMPTS = 6;

export interface DomainEventRow {
  id: string;
  eventType: DomainEventType;
  aggregateType: string;
  aggregateId: string;
  orgId: string;
  teamId: string;
  boardId: string;
  actorId: string | null;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  attempts: number;
}

export type DomainEventHandler = (event: DomainEventRow) => Promise<void>;
export type PeriodicTask = () => Promise<void>;

export interface WorkerQueueStats {
  pending: number;
  deadLettered: number;
  oldestPendingAgeSec: number | null;
}

export interface WorkerHealthSnapshot {
  status: "healthy" | "stale" | "offline";
  mode: "embedded" | "separate";
  workerId: string | null;
  lastHeartbeatAt: string | null;
  startedAt: string | null;
  processedEvents: number;
  lastError: string | null;
  queues: {
    domainEvents: WorkerQueueStats;
    emailOutbox: WorkerQueueStats;
    webhookDeliveries: WorkerQueueStats;
  };
}

function computeBackoffMs(attempts: number): number {
  const base = Math.min(1000 * 2 ** Math.max(0, attempts - 1), 15 * 60 * 1000);
  const jitter = Math.floor(Math.random() * Math.min(5000, base * 0.25));
  return base + jitter;
}

class BackgroundWorker {
  public readonly workerId = `pw-worker-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
  private mode: "embedded" | "separate" =
    process.env.WORKER_MODE === "separate" ? "separate" : "embedded";
  private started = false;
  private stopped = false;
  private isLeader = false;
  private leaderClient: Client | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private leaderRetryTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private wakePending = false;
  private processedCount = 0;
  private startedAt = new Date();
  private lastError: string | null = null;

  private domainEventHandlers: DomainEventHandler[] = [];
  private emailBatchProcessor: (() => Promise<number>) | null = null;
  private webhookBatchProcessor: (() => Promise<number>) | null = null;
  private maintenanceTasks: PeriodicTask[] = [];

  public registerDomainEventHandler(handler: DomainEventHandler): void {
    this.domainEventHandlers.push(handler);
  }

  public setEmailBatchProcessor(fn: () => Promise<number>): void {
    this.emailBatchProcessor = fn;
  }

  public setWebhookBatchProcessor(fn: () => Promise<number>): void {
    this.webhookBatchProcessor = fn;
  }

  public registerMaintenanceTask(task: PeriodicTask): void {
    this.maintenanceTasks.push(task);
  }

  public getIsLeader(): boolean {
    return this.isLeader;
  }

  public async start(mode?: "embedded" | "separate"): Promise<void> {
    if (this.started) return;
    if (mode) this.mode = mode;
    this.started = true;
    this.stopped = false;
    this.startedAt = new Date();

    await import("./notifications");
    await import("./email-notifications");
    await import("./webhooks");
    const { presenceHub } = await import("./presence");
    this.registerMaintenanceTask(async () => {
      presenceHub.sweepExpired();
    });
    await this.tryAcquireLeadership();

    this.leaderRetryTimer = setInterval(() => {
      if (!this.stopped && !this.isLeader) {
        this.tryAcquireLeadership().catch(() => undefined);
      }
    }, 10000);

    this.pollTimer = setInterval(() => {
      if (!this.stopped && this.isLeader) {
        this.triggerTick();
      }
    }, 2000);

    this.maintenanceTimer = setInterval(() => {
      if (!this.stopped && this.isLeader) {
        this.runMaintenance().catch(() => undefined);
      }
    }, 60000);
  }

  private async tryAcquireLeadership(): Promise<void> {
    if (this.stopped || this.isLeader) return;
    const connectionString =
      process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test";
    const client = new Client({ connectionString });
    client.on("error", () => {
      this.releaseLeaderClient();
    });
    client.on("end", () => {
      this.releaseLeaderClient();
    });

    try {
      await client.connect();
      const res = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS acquired",
        [WORKER_LOCK_ID]
      );
      if (!res.rows[0]?.acquired) {
        await client.end().catch(() => undefined);
        return;
      }

      client.on("notification", (msg) => {
        if (msg.channel === "patchwork_domain_events" && !this.stopped) {
          this.triggerTick();
        }
      });
      await client.query("LISTEN patchwork_domain_events");
      this.leaderClient = client;
      this.isLeader = true;
      await this.upsertHealth();
      this.triggerTick();
    } catch {
      await client.end().catch(() => undefined);
    }
  }

  private releaseLeaderClient(): void {
    this.isLeader = false;
    if (this.leaderClient) {
      const c = this.leaderClient;
      this.leaderClient = null;
      c.end().catch(() => undefined);
    }
  }

  public triggerTick(): void {
    if (this.stopped || !this.isLeader) return;
    if (this.inFlight) {
      this.wakePending = true;
      return;
    }
    this.inFlight = this.runTickLoop()
      .catch((err) => {
        this.lastError = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        this.inFlight = null;
        if (this.wakePending && !this.stopped) {
          this.wakePending = false;
          this.triggerTick();
        }
      });
  }

  private async runTickLoop(): Promise<void> {
    if (this.stopped || !this.isLeader) return;
    let didWork = true;
    while (didWork && !this.stopped && this.isLeader) {
      const processedEvents = await this.processDomainEventsBatch(25);
      const processedEmails = this.emailBatchProcessor ? await this.emailBatchProcessor() : 0;
      const processedWebhooks = this.webhookBatchProcessor
        ? await this.webhookBatchProcessor()
        : 0;
      didWork = processedEvents > 0 || processedEmails > 0 || processedWebhooks > 0;
    }
    await this.upsertHealth().catch(() => undefined);
  }

  public async processDomainEventsBatch(limit = 25): Promise<number> {
    const client = await pool.connect();
    let rows: DomainEventRow[] = [];
    try {
      await client.query("BEGIN");
      const res = await client.query<{
        id: string;
        event_type: DomainEventType;
        aggregate_type: string;
        aggregate_id: string;
        org_id: string;
        team_id: string;
        board_id: string;
        actor_id: string | null;
        idempotency_key: string;
        metadata: Record<string, unknown>;
        created_at: Date;
        attempts: number;
      }>(
        `
        SELECT id, event_type, aggregate_type, aggregate_id, org_id, team_id, board_id,
               actor_id, idempotency_key, metadata, created_at, attempts
        FROM domain_events
        WHERE processed_at IS NULL
          AND dead_lettered_at IS NULL
          AND next_attempt_at <= NOW()
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
        `,
        [limit]
      );
      rows = res.rows.map((r) => ({
        id: r.id,
        eventType: r.event_type,
        aggregateType: r.aggregate_type,
        aggregateId: r.aggregate_id,
        orgId: r.org_id,
        teamId: r.team_id,
        boardId: r.board_id,
        actorId: r.actor_id,
        idempotencyKey: r.idempotency_key,
        metadata: r.metadata || {},
        createdAt: r.created_at,
        attempts: r.attempts,
      }));

      for (const ev of rows) {
        try {
          for (const handler of this.domainEventHandlers) {
            await handler(ev);
          }
          await client.query(
            `UPDATE domain_events SET processed_at = NOW(), last_error = NULL WHERE id = $1`,
            [ev.id]
          );
          this.processedCount += 1;
        } catch (err) {
          const nextAttempts = ev.attempts + 1;
          const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
          this.lastError = msg;
          if (nextAttempts >= MAX_ATTEMPTS) {
            await client.query(
              `UPDATE domain_events
               SET attempts = $2, dead_lettered_at = NOW(), last_error = $3
               WHERE id = $1`,
              [ev.id, nextAttempts, msg]
            );
          } else {
            const delayMs = computeBackoffMs(nextAttempts);
            await client.query(
              `UPDATE domain_events
               SET attempts = $2,
                   next_attempt_at = NOW() + ($3 || ' milliseconds')::interval,
                   last_error = $4
               WHERE id = $1`,
              [ev.id, nextAttempts, String(delayMs), msg]
            );
          }
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    return rows.length;
  }

  public async runMaintenance(): Promise<void> {
    if (this.stopped || !this.isLeader) return;
    for (const task of this.maintenanceTasks) {
      try {
        await task();
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err);
      }
    }
    // Clean up processed domain events older than 30 days
    await pool
      .query(
        `DELETE FROM domain_events
         WHERE processed_at IS NOT NULL
           AND processed_at < NOW() - INTERVAL '30 days'`
      )
      .catch(() => undefined);
    await this.upsertHealth().catch(() => undefined);
  }

  private async upsertHealth(): Promise<void> {
    await pool.query(
      `INSERT INTO worker_health (id, worker_id, mode, started_at, last_heartbeat_at, processed_events, last_error, updated_at)
       VALUES ('default', $1, $2, $3, NOW(), $4, $5, NOW())
       ON CONFLICT (id) DO UPDATE SET
         worker_id = EXCLUDED.worker_id,
         mode = EXCLUDED.mode,
         last_heartbeat_at = NOW(),
         processed_events = worker_health.processed_events + $4,
         last_error = EXCLUDED.last_error,
         updated_at = NOW()`,
      [this.workerId, this.mode, this.startedAt, this.processedCount, this.lastError]
    );
    this.processedCount = 0;
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    if (this.leaderRetryTimer) clearInterval(this.leaderRetryTimer);
    this.pollTimer = null;
    this.maintenanceTimer = null;
    this.leaderRetryTimer = null;
    if (this.inFlight) {
      await this.inFlight.catch(() => undefined);
    }
    if (this.leaderClient) {
      await this.leaderClient.query("SELECT pg_advisory_unlock($1)", [WORKER_LOCK_ID]).catch(() => undefined);
    }
    this.releaseLeaderClient();
    this.started = false;
  }
}

const globalForWorker = globalThis as unknown as {
  __patchworkWorker?: BackgroundWorker;
};

export const backgroundWorker =
  globalForWorker.__patchworkWorker ?? new BackgroundWorker();

if (process.env.NODE_ENV !== "production") {
  globalForWorker.__patchworkWorker = backgroundWorker;
}

export async function getWorkerHealthSnapshot(): Promise<WorkerHealthSnapshot> {
  const [healthRes, evRes, emailRes, webhookRes] = await Promise.all([
    pool
      .query<{
        worker_id: string;
        mode: "embedded" | "separate";
        started_at: Date;
        last_heartbeat_at: Date;
        processed_events: number;
        last_error: string | null;
      }>(`SELECT worker_id, mode, started_at, last_heartbeat_at, processed_events, last_error FROM worker_health WHERE id = 'default' LIMIT 1`)
      .catch(() => ({ rows: [] })),
    pool
      .query<{ pending: string; dead: string; oldest_sec: number | null }>(
        `SELECT
           COUNT(*) FILTER (WHERE processed_at IS NULL AND dead_lettered_at IS NULL)::text AS pending,
           COUNT(*) FILTER (WHERE dead_lettered_at IS NOT NULL)::text AS dead,
           EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE processed_at IS NULL AND dead_lettered_at IS NULL)))::int AS oldest_sec
         FROM domain_events`
      )
      .catch(() => ({ rows: [{ pending: "0", dead: "0", oldest_sec: null }] })),
    pool
      .query<{ pending: string; dead: string; oldest_sec: number | null }>(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
           COUNT(*) FILTER (WHERE status = 'dead_letter')::text AS dead,
           EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'pending')))::int AS oldest_sec
         FROM email_outbox`
      )
      .catch(() => ({ rows: [{ pending: "0", dead: "0", oldest_sec: null }] })),
    pool
      .query<{ pending: string; dead: string; oldest_sec: number | null }>(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('pending', 'failed'))::text AS pending,
           COUNT(*) FILTER (WHERE status = 'dead_letter')::text AS dead,
           EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status IN ('pending', 'failed'))))::int AS oldest_sec
         FROM webhook_deliveries`
      )
      .catch(() => ({ rows: [{ pending: "0", dead: "0", oldest_sec: null }] })),
  ]);

  const h = healthRes.rows[0];
  const heartbeatAgeMs = h ? Date.now() - new Date(h.last_heartbeat_at).getTime() : Infinity;
  const status: "healthy" | "stale" | "offline" = !h
    ? "offline"
    : heartbeatAgeMs <= 120_000
    ? "healthy"
    : "stale";

  const ev = evRes.rows[0] || { pending: "0", dead: "0", oldest_sec: null };
  const em = emailRes.rows[0] || { pending: "0", dead: "0", oldest_sec: null };
  const wh = webhookRes.rows[0] || { pending: "0", dead: "0", oldest_sec: null };

  return {
    status,
    mode: h?.mode || (process.env.WORKER_MODE === "separate" ? "separate" : "embedded"),
    workerId: h?.worker_id || null,
    lastHeartbeatAt: h ? new Date(h.last_heartbeat_at).toISOString() : null,
    startedAt: h ? new Date(h.started_at).toISOString() : null,
    processedEvents: h?.processed_events ?? 0,
    lastError: h?.last_error ?? null,
    queues: {
      domainEvents: {
        pending: Number(ev.pending || 0),
        deadLettered: Number(ev.dead || 0),
        oldestPendingAgeSec: ev.oldest_sec ?? null,
      },
      emailOutbox: {
        pending: Number(em.pending || 0),
        deadLettered: Number(em.dead || 0),
        oldestPendingAgeSec: em.oldest_sec ?? null,
      },
      webhookDeliveries: {
        pending: Number(wh.pending || 0),
        deadLettered: Number(wh.dead || 0),
        oldestPendingAgeSec: wh.oldest_sec ?? null,
      },
    },
  };
}
