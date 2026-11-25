import { Client } from "pg";
import { pool } from "@/db";
import { getSystemSetting } from "./settings";
import { canUserViewTicket, getUserNotificationPrefs } from "./watchers";

export const VIEW_EXPIRY_MS = 35_000;
export const TYPING_EXPIRY_MS = 5_000;

interface PresenceEntry {
  userId: string;
  name: string;
  tabIds: Set<string>;
  lastSeenAt: number;
  typingUntil: number;
}

export interface RoomPresenceSnapshot {
  ticketId: string;
  viewers: Array<{ userId: string; name: string }>;
  typers: Array<{ userId: string; name: string }>;
}

type RoomListener = (snapshot: RoomPresenceSnapshot) => void;

class PresenceHub {
  private rooms = new Map<string, Map<string, PresenceEntry>>();
  private listeners = new Map<string, Set<RoomListener>>();
  private lastUserPostAt = new Map<string, number>();
  private flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pgClient: Client | null = null;
  private connecting: Promise<void> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  private ensureSweeper() {
    if (this.sweepTimer || process.env.NODE_ENV === "test") return;
    this.sweepTimer = setInterval(() => {
      this.sweepExpired();
    }, 10_000);
  }

  public async ensureListening(): Promise<void> {
    if (this.pgClient) return;
    if (this.connecting) return this.connecting;
    this.ensureSweeper();

    this.connecting = (async () => {
      const connectionString =
        process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test";
      const client = new Client({ connectionString });
      client.on("error", () => {
        this.pgClient = null;
        this.connecting = null;
      });
      client.on("end", () => {
        this.pgClient = null;
        this.connecting = null;
      });
      client.on("notification", (msg) => {
        if (msg.channel === "patchwork_presence" && msg.payload) {
          try {
            const ev = JSON.parse(msg.payload) as {
              ticketId: string;
              userId: string;
              name: string;
              tabId: string;
              state: "view" | "typing" | "leave";
            };
            this.applyLocalEvent(ev);
          } catch {
            // ignore malformed
          }
        }
      });
      await client.connect();
      await client.query("LISTEN patchwork_presence");
      this.pgClient = client;
      this.connecting = null;
    })().catch((err) => {
      this.pgClient = null;
      this.connecting = null;
      throw err;
    });

    return this.connecting;
  }

  public applyLocalEvent(ev: {
    ticketId: string;
    userId: string;
    name: string;
    tabId: string;
    state: "view" | "typing" | "leave";
  }): void {
    const now = Date.now();
    let room = this.rooms.get(ev.ticketId);

    if (ev.state === "leave") {
      if (!room) return;
      const entry = room.get(ev.userId);
      if (!entry) return;
      entry.tabIds.delete(ev.tabId);
      if (entry.tabIds.size === 0) {
        room.delete(ev.userId);
      }
      if (room.size === 0) this.rooms.delete(ev.ticketId);
      this.scheduleFlush(ev.ticketId);
      return;
    }

    if (!room) {
      room = new Map();
      this.rooms.set(ev.ticketId, room);
    }

    let entry = room.get(ev.userId);
    if (!entry) {
      entry = {
        userId: ev.userId,
        name: ev.name,
        tabIds: new Set(),
        lastSeenAt: now,
        typingUntil: 0,
      };
      room.set(ev.userId, entry);
    }
    entry.name = ev.name;
    entry.tabIds.add(ev.tabId);
    entry.lastSeenAt = now;
    if (ev.state === "typing") {
      entry.typingUntil = now + TYPING_EXPIRY_MS;
    }
    this.scheduleFlush(ev.ticketId);
  }

  private scheduleFlush(ticketId: string): void {
    if (this.flushTimers.has(ticketId)) return;
    const t = setTimeout(() => {
      this.flushTimers.delete(ticketId);
      const set = this.listeners.get(ticketId);
      if (!set || set.size === 0) return;
      const snap = this.getSnapshot(ticketId);
      for (const fn of set) {
        try {
          fn(snap);
        } catch {
          // ignore
        }
      }
    }, 80);
    this.flushTimers.set(ticketId, t);
  }

  public async publishHeartbeat(input: {
    ticketId: string;
    orgId: string;
    teamId: string;
    userId: string;
    name: string;
    tabId: string;
    state: "view" | "typing" | "leave";
  }): Promise<RoomPresenceSnapshot> {
    const settings = await getSystemSetting("notifications").catch(() => ({
      presenceEnabled: true,
    }));
    if (!settings.presenceEnabled) {
      return { ticketId: input.ticketId, viewers: [], typers: [] };
    }

    if (input.state !== "leave") {
      // Rate limit per user+ticket
      const rlKey = `${input.userId}:${input.ticketId}:${input.state}`;
      const prev = this.lastUserPostAt.get(rlKey) || 0;
      const now = Date.now();
      if (input.state === "typing" && now - prev < 800) {
        return this.getSnapshot(input.ticketId);
      }
      this.lastUserPostAt.set(rlKey, now);

      const [hasAccess, prefs] = await Promise.all([
        canUserViewTicket(input.userId, { orgId: input.orgId, teamId: input.teamId }),
        getUserNotificationPrefs(input.userId),
      ]);
      if (!hasAccess || !prefs.presenceEnabled) {
        return this.getSnapshot(input.ticketId);
      }
    }

    const payload = {
      ticketId: input.ticketId,
      userId: input.userId,
      name: input.name,
      tabId: input.tabId,
      state: input.state,
    };
    this.applyLocalEvent(payload);

    await pool
      .query("SELECT pg_notify('patchwork_presence', $1)", [JSON.stringify(payload)])
      .catch(() => undefined);

    return this.getSnapshot(input.ticketId);
  }

  public removeUserEverywhere(userId: string): void {
    for (const [ticketId, room] of this.rooms.entries()) {
      if (room.delete(userId)) {
        if (room.size === 0) this.rooms.delete(ticketId);
        this.scheduleFlush(ticketId);
      }
    }
  }

  public sweepExpired(now = Date.now()): number {
    let removed = 0;
    for (const [ticketId, room] of this.rooms.entries()) {
      let changed = false;
      for (const [userId, entry] of room.entries()) {
        if (now - entry.lastSeenAt > VIEW_EXPIRY_MS) {
          room.delete(userId);
          removed += 1;
          changed = true;
        } else if (entry.typingUntil > 0 && now > entry.typingUntil) {
          entry.typingUntil = 0;
          changed = true;
        }
      }
      if (room.size === 0) this.rooms.delete(ticketId);
      if (changed) this.scheduleFlush(ticketId);
    }
    return removed;
  }

  public getSnapshot(ticketId: string, now = Date.now()): RoomPresenceSnapshot {
    const room = this.rooms.get(ticketId);
    if (!room) return { ticketId, viewers: [], typers: [] };
    const viewers: Array<{ userId: string; name: string }> = [];
    const typers: Array<{ userId: string; name: string }> = [];

    for (const entry of room.values()) {
      if (now - entry.lastSeenAt <= VIEW_EXPIRY_MS) {
        viewers.push({ userId: entry.userId, name: entry.name });
        if (entry.typingUntil > now) {
          typers.push({ userId: entry.userId, name: entry.name });
        }
      }
    }
    return { ticketId, viewers, typers };
  }

  public async subscribe(ticketId: string, listener: RoomListener): Promise<() => void> {
    await this.ensureListening();
    let set = this.listeners.get(ticketId);
    if (!set) {
      set = new Set();
      this.listeners.set(ticketId, set);
    }
    set.add(listener);
    return () => {
      const cur = this.listeners.get(ticketId);
      if (cur) {
        cur.delete(listener);
        if (cur.size === 0) this.listeners.delete(ticketId);
      }
    };
  }
}

const globalForPresence = globalThis as unknown as {
  __pwPresenceHub?: PresenceHub;
};

export const presenceHub = globalForPresence.__pwPresenceHub ?? new PresenceHub();
if (process.env.NODE_ENV !== "production") {
  globalForPresence.__pwPresenceHub = presenceHub;
}
