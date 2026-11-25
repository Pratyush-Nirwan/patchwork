import { Client } from "pg";

type UserListener = (notificationId: string) => void;

class UserNotificationHub {
  private listenersByUser = new Map<string, Set<UserListener>>();
  private pgClient: Client | null = null;
  private connecting: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;

  private totalListeners(): number {
    let total = 0;
    for (const set of this.listenersByUser.values()) total += set.size;
    return total;
  }

  private scheduleReconnect(): void {
    if (this.totalListeners() === 0 || this.reconnectTimer) return;
    const delayMs = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.totalListeners() > 0) {
        this.ensureListening().catch(() => this.scheduleReconnect());
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
        if (msg.channel === "patchwork_user_notifications" && msg.payload) {
          try {
            const parsed = JSON.parse(msg.payload) as {
              recipientId?: string;
              notificationId?: string;
            };
            if (!parsed.recipientId || !parsed.notificationId) return;
            const set = this.listenersByUser.get(parsed.recipientId);
            if (!set) return;
            for (const fn of set) {
              try {
                fn(parsed.notificationId);
              } catch {
                // ignore listener error
              }
            }
          } catch {
            // ignore malformed payload
          }
        }
      });
      await client.connect();
      await client.query("LISTEN patchwork_user_notifications");
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

  public async subscribe(userId: string, listener: UserListener): Promise<() => void> {
    await this.ensureListening();
    let set = this.listenersByUser.get(userId);
    if (!set) {
      set = new Set();
      this.listenersByUser.set(userId, set);
    }
    set.add(listener);
    return () => {
      const current = this.listenersByUser.get(userId);
      if (current) {
        current.delete(listener);
        if (current.size === 0) this.listenersByUser.delete(userId);
      }
    };
  }
}

const globalForNotifHub = globalThis as unknown as {
  __pwUserNotificationHub?: UserNotificationHub;
};

export const userNotificationHub =
  globalForNotifHub.__pwUserNotificationHub ?? new UserNotificationHub();

if (process.env.NODE_ENV !== "production") {
  globalForNotifHub.__pwUserNotificationHub = userNotificationHub;
}
