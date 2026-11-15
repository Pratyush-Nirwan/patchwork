import { Client } from "pg";
import { pool } from "@/db";

export interface RealtimeEvent {
  id: string;
  type:
    | "ticket.created"
    | "ticket.updated"
    | "ticket.moved"
    | "ticket.deleted"
    | "column.created"
    | "column.updated"
    | "column.reordered"
    | "column.deleted"
    | "comment.added"
    | "attachment.added"
    | "attachment.removed"
    | "link.added"
    | "link.removed";
  orgId: string;
  teamId: string;
  boardId: string;
  ticketId?: string;
  actorId?: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

type Listener = (event: RealtimeEvent) => void;

class RealtimeHub {
  private listeners = new Set<Listener>();
  private pgClient: Client | null = null;
  private connecting: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;

  private scheduleReconnect(): void {
    if (this.listeners.size === 0 || this.reconnectTimer) return;
    const delayMs = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.listeners.size > 0) {
        this.ensureListening().catch(() => {
          this.scheduleReconnect();
        });
      }
    }, delayMs);
  }

  public async ensureListening(): Promise<void> {
    if (this.pgClient) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const connectionString =
        process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test";
      const client = new Client({ connectionString });
      client.on("error", () => {
        this.pgClient = null;
        this.connecting = null;
        this.scheduleReconnect();
      });
      client.on("end", () => {
        this.pgClient = null;
        this.connecting = null;
        this.scheduleReconnect();
      });
      client.on("notification", (msg) => {
        if (msg.channel === "patchwork_events" && msg.payload) {
          try {
            const event = JSON.parse(msg.payload) as RealtimeEvent;
            for (const listener of this.listeners) {
              try {
                listener(event);
              } catch {
                // ignore individual listener error
              }
            }
          } catch {
            // ignore malformed JSON
          }
        }
      });
      await client.connect();
      await client.query("LISTEN patchwork_events");
      this.pgClient = client;
      this.connecting = null;
      this.reconnectAttempts = 0;
    })().catch((err) => {
      this.pgClient = null;
      this.connecting = null;
      throw err;
    });

    return this.connecting;
  }

  public async subscribe(listener: Listener): Promise<() => void> {
    await this.ensureListening();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getListenerCount(): number {
    return this.listeners.size;
  }

  public async publish(
    event: Omit<RealtimeEvent, "id" | "timestamp">
  ): Promise<RealtimeEvent> {
    const fullEvent: RealtimeEvent = {
      ...event,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };
    const json = JSON.stringify(fullEvent);
    await pool.query("SELECT pg_notify('patchwork_events', $1)", [json]);
    return fullEvent;
  }

  public async close(): Promise<void> {
    this.listeners.clear();
    if (this.pgClient) {
      const c = this.pgClient;
      this.pgClient = null;
      await c.end().catch(() => undefined);
    }
  }
}

const globalForRealtime = globalThis as unknown as {
  realtimeHub?: RealtimeHub;
};

export const realtimeHub = globalForRealtime.realtimeHub ?? new RealtimeHub();
if (process.env.NODE_ENV !== "production") {
  globalForRealtime.realtimeHub = realtimeHub;
}

