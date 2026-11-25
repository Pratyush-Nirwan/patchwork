import crypto from "crypto";
import dns from "dns/promises";
import http from "http";
import https from "https";
import net from "net";
import { and, desc, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  tickets,
  users,
  webhookDeliveries,
  webhookEndpoints,
  type WebhookFormat,
} from "@/db/schema";
import { decryptSetupToken, encryptSetupToken } from "./setup-token";
import { getSystemSetting } from "./settings";
import { redactSecrets } from "./diagnostics";
import { backgroundWorker, type DomainEventRow } from "./worker";
import { setDomainEventWebhookHook } from "./notifications";
import { AppError, NotFoundError } from "./errors";

const MAX_WEBHOOK_ATTEMPTS = 6;
const CIRCUIT_BREAKER_THRESHOLD = 10;
const WEBHOOK_TIMEOUT_MS = 5000;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;

export const WEBHOOK_EVENT_TYPES = [
  "ticket.created",
  "ticket.updated",
  "ticket.moved",
  "ticket.assigned",
  "comment.created",
  "mention",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  const inRange = (cidrBase: string, bits: number) => {
    const base = ipv4ToInt(cidrBase);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (base & mask);
  };
  return (
    inRange("0.0.0.0", 8) || // "This" network
    inRange("10.0.0.0", 8) || // RFC1918 private
    inRange("100.64.0.0", 10) || // CGNAT
    inRange("127.0.0.0", 8) || // Loopback
    inRange("169.254.0.0", 16) || // Link-local & cloud metadata
    inRange("172.16.0.0", 12) || // RFC1918 private
    inRange("192.0.0.0", 24) || // IETF protocol
    inRange("192.0.2.0", 24) || // TEST-NET-1
    inRange("192.168.0.0", 16) || // RFC1918 private
    inRange("198.18.0.0", 15) || // Benchmarking
    inRange("198.51.100.0", 24) || // TEST-NET-2
    inRange("203.0.113.0", 24) || // TEST-NET-3
    inRange("224.0.0.0", 4) || // Multicast
    inRange("240.0.0.0", 4) // Reserved / broadcast
  );
}

function isBlockedIp(rawIp: string): boolean {
  const ip = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIPv4(ip)) {
    return isBlockedIpv4(ip);
  }
  if (net.isIPv6(ip)) {
    // Handle IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
    if (ip.startsWith("::ffff:")) {
      const tail = ip.slice(7);
      if (net.isIPv4(tail)) return isBlockedIpv4(tail);
      const hexParts = tail.split(":");
      if (hexParts.length === 2) {
        const hi = parseInt(hexParts[0], 16);
        const lo = parseInt(hexParts[1], 16);
        if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
          const v4 = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
          return isBlockedIpv4(v4);
        }
      }
    }
    if (ip === "::" || ip === "::1") return true; // Unspecified / loopback
    if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // ULA private fc00::/7
    if (
      ip.startsWith("fe8") ||
      ip.startsWith("fe9") ||
      ip.startsWith("fea") ||
      ip.startsWith("feb")
    ) {
      return true; // Link-local fe80::/10
    }
    if (ip.startsWith("ff")) return true; // Multicast ff00::/8
    return false;
  }
  return true;
}

export async function validateAndResolveWebhookTarget(
  rawUrl: string,
  allowPrivateNetwork: boolean
): Promise<{
  url: URL;
  pinnedIp: string;
  pinnedFamily: 4 | 6;
}> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new AppError("Invalid webhook URL", 400);
  }

  if (url.username || url.password) {
    throw new AppError("Webhook URL must not contain embedded credentials", 400);
  }

  if (!allowPrivateNetwork && url.protocol !== "https:") {
    throw new AppError(
      "Webhook URL must use HTTPS (enable private-network webhooks in settings for local HTTP)",
      400
    );
  }
  if (allowPrivateNetwork && url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AppError("Webhook URL must use HTTP or HTTPS", 400);
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) {
    throw new AppError("Webhook URL hostname is missing", 400);
  }

  // If hostname is already an IP literal (after URL normalization of decimal/octal/hex)
  const ipKind = net.isIP(host);
  if (ipKind === 4 || ipKind === 6) {
    if (!allowPrivateNetwork && isBlockedIp(host)) {
      throw new AppError("Webhook target IP address is blocked by SSRF policy", 400);
    }
    return { url, pinnedIp: host, pinnedFamily: ipKind };
  }

  const records = await dns.lookup(host, { all: true }).catch(() => []);
  if (records.length === 0) {
    throw new AppError(`Could not resolve webhook hostname: ${host}`, 400);
  }

  for (const rec of records) {
    if (!allowPrivateNetwork && isBlockedIp(rec.address)) {
      throw new AppError(
        "Webhook hostname resolves to a private or reserved IP address",
        400
      );
    }
  }

  const primary = records[0];
  return {
    url,
    pinnedIp: primary.address,
    pinnedFamily: primary.family === 6 ? 6 : 4,
  };
}

export function signWebhookPayload(
  secret: string,
  timestampSec: number,
  rawBody: string
): string {
  const mac = crypto
    .createHmac("sha256", secret)
    .update(`${timestampSec}.${rawBody}`)
    .digest("hex");
  return `v1=${mac}`;
}

export function formatWebhookBody(
  format: WebhookFormat,
  genericPayload: Record<string, unknown>
): string {
  const data = (genericPayload.data || {}) as Record<string, unknown>;
  const ticket = (data.ticket || {}) as Record<string, unknown>;
  const actor = (data.actor || {}) as Record<string, unknown>;
  const event = String(genericPayload.event || "event");
  const actorName = String(actor.name || "Someone");
  const ticketKey = String(ticket.key || "");
  const ticketTitle = String(ticket.title || "");
  const ticketUrl = String(ticket.url || "");
  const summaryText = ticketKey
    ? `[Patchwork] ${actorName} · ${event} · ${ticketKey}: ${ticketTitle}`
    : `[Patchwork] ${actorName} · ${event}`;

  let obj: unknown;
  if (format === "slack") {
    obj = {
      text: `${summaryText}${ticketUrl ? ` (${ticketUrl})` : ""}`.slice(0, 3000),
    };
  } else if (format === "discord") {
    obj = {
      content: summaryText.slice(0, 1900),
      embeds: ticketKey
        ? [
            {
              title: `${ticketKey}: ${ticketTitle}`.slice(0, 250),
              url: ticketUrl || undefined,
              description: `Event: ${event} by ${actorName}`.slice(0, 1000),
            },
          ]
        : undefined,
    };
  } else if (format === "mattermost") {
    obj = {
      username: "Patchwork",
      text: ticketUrl
        ? `**[${ticketKey}](${ticketUrl})** ${ticketTitle} — *${event}* by ${actorName}`.slice(
            0,
            3500
          )
        : summaryText.slice(0, 3500),
    };
  } else {
    obj = genericPayload;
  }

  const json = JSON.stringify(obj);
  if (Buffer.byteLength(json, "utf8") > MAX_PAYLOAD_BYTES) {
    return JSON.stringify({
      version: 1,
      event,
      deliveryId: genericPayload.deliveryId,
      timestamp: genericPayload.timestamp,
      truncated: true,
    });
  }
  return json;
}

async function sendPinnedWebhookRequest(input: {
  url: URL;
  pinnedIp: string;
  pinnedFamily: 4 | 6;
  body: string;
  headers: Record<string, string>;
}): Promise<{ ok: boolean; statusCode: number; durationMs: number; error?: string }> {
  const start = Date.now();
  const isHttps = input.url.protocol === "https:";
  const transport = isHttps ? https : http;
  const port = input.url.port ? Number(input.url.port) : isHttps ? 443 : 80;

  return new Promise((resolve) => {
    const req = transport.request(
      {
        host: input.pinnedIp,
        port,
        family: input.pinnedFamily,
        path: `${input.url.pathname}${input.url.search}`,
        method: "POST",
        timeout: WEBHOOK_TIMEOUT_MS,
        headers: {
          ...input.headers,
          Host: input.url.host,
          "Content-Length": String(Buffer.byteLength(input.body, "utf8")),
        },
        ...(isHttps ? { servername: input.url.hostname } : {}),
      },
      (res) => {
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            res.destroy();
          }
        });
        res.on("end", () => {
          const statusCode = res.statusCode ?? 0;
          const durationMs = Date.now() - start;
          if (statusCode >= 200 && statusCode < 300) {
            resolve({ ok: true, statusCode, durationMs });
          } else {
            resolve({
              ok: false,
              statusCode,
              durationMs,
              error: `HTTP ${statusCode}`,
            });
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("Webhook request timed out after 5000ms"));
    });
    req.on("error", (err) => {
      resolve({
        ok: false,
        statusCode: 0,
        durationMs: Date.now() - start,
        error: redactSecrets(err.message).slice(0, 300),
      });
    });

    req.write(input.body);
    req.end();
  });
}

export async function createWebhookEndpoint(
  orgId: string,
  actorId: string,
  input: {
    name: string;
    url: string;
    format: WebhookFormat;
    events: string[];
    scopeTeamIds?: string[];
    scopeProjectIds?: string[];
    scopeBoardIds?: string[];
    enabled?: boolean;
  }
) {
  const settings = await getSystemSetting("notifications");
  await validateAndResolveWebhookTarget(input.url, settings.allowPrivateNetworkWebhooks);

  const rawSecret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
  const enc = encryptSetupToken(rawSecret);

  const [created] = await db
    .insert(webhookEndpoints)
    .values({
      orgId,
      name: input.name.trim(),
      url: input.url.trim(),
      format: input.format,
      events: input.events,
      scopeTeamIds: input.scopeTeamIds || [],
      scopeProjectIds: input.scopeProjectIds || [],
      scopeBoardIds: input.scopeBoardIds || [],
      secretCiphertext: enc.ciphertext,
      secretIv: enc.iv,
      secretAuthTag: enc.authTag,
      secretKeyVersion: enc.keyVersion,
      enabled: input.enabled ?? true,
      createdById: actorId,
    })
    .returning();

  return {
    endpoint: sanitizeEndpointForApi(created),
    secret: rawSecret, // Returned ONCE on creation
  };
}

export async function rotateWebhookSecret(endpointId: string, orgId: string) {
  const [existing] = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.orgId, orgId)))
    .limit(1);
  if (!existing) throw new NotFoundError("Webhook endpoint not found");

  const rawSecret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
  const enc = encryptSetupToken(rawSecret);

  const [updated] = await db
    .update(webhookEndpoints)
    .set({
      secretCiphertext: enc.ciphertext,
      secretIv: enc.iv,
      secretAuthTag: enc.authTag,
      secretKeyVersion: enc.keyVersion,
      updatedAt: new Date(),
    })
    .where(eq(webhookEndpoints.id, endpointId))
    .returning();

  return {
    endpoint: sanitizeEndpointForApi(updated),
    secret: rawSecret,
  };
}

export function sanitizeEndpointForApi(row: typeof webhookEndpoints.$inferSelect) {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    url: row.url,
    format: row.format,
    events: row.events,
    scopeTeamIds: row.scopeTeamIds,
    scopeProjectIds: row.scopeProjectIds,
    scopeBoardIds: row.scopeBoardIds,
    enabled: row.enabled,
    consecutiveFailures: row.consecutiveFailures,
    disabledReason: row.disabledReason,
    disabledAt: row.disabledAt ? row.disabledAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function enqueueWebhooksForDomainEvent(event: DomainEventRow): Promise<void> {
  const mappedEvents: WebhookEventType[] = [];
  if (event.eventType === "ticket.created") mappedEvents.push("ticket.created");
  else if (event.eventType === "ticket.moved") mappedEvents.push("ticket.moved");
  else if (event.eventType === "comment.created") mappedEvents.push("comment.created");
  else if (event.eventType === "ticket.updated") {
    mappedEvents.push("ticket.updated");
    if (event.metadata?.assigneeTo) mappedEvents.push("ticket.assigned");
  }
  const mentionedIds = Array.isArray(event.metadata?.mentionedUserIds)
    ? (event.metadata.mentionedUserIds as string[])
    : [];
  if (mentionedIds.length > 0) mappedEvents.push("mention");

  if (mappedEvents.length === 0) return;

  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(
      and(eq(webhookEndpoints.orgId, event.orgId), eq(webhookEndpoints.enabled, true))
    );
  if (endpoints.length === 0) return;

  const [ticket] = await db
    .select({
      id: tickets.id,
      key: tickets.key,
      title: tickets.title,
      priority: tickets.priority,
      projectId: tickets.projectId,
      teamId: tickets.teamId,
      boardId: tickets.boardId,
    })
    .from(tickets)
    .where(eq(tickets.id, event.aggregateId))
    .limit(1);
  if (!ticket) return;

  const actor = event.actorId
    ? (
        await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.id, event.actorId))
          .limit(1)
      )[0]
    : null;

  let mentionDisplayNames: string[] = [];
  if (mentionedIds.length > 0) {
    const mRows = await db
      .select({ id: users.id, name: users.name })
      .from(users);
    const idSet = new Set(mentionedIds);
    mentionDisplayNames = mRows.filter((u) => idSet.has(u.id)).map((u) => u.name);
  }

  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

  for (const ep of endpoints) {
    if (ep.scopeTeamIds.length > 0 && !ep.scopeTeamIds.includes(ticket.teamId)) continue;
    if (ep.scopeProjectIds.length > 0 && !ep.scopeProjectIds.includes(ticket.projectId)) continue;
    if (ep.scopeBoardIds.length > 0 && !ep.scopeBoardIds.includes(ticket.boardId)) continue;

    for (const evName of mappedEvents) {
      if (!ep.events.includes(evName)) continue;

      const deliveryId = crypto.randomUUID();
      const payload: Record<string, unknown> = {
        version: 1,
        event: evName,
        deliveryId,
        timestamp: new Date().toISOString(),
        data: {
          orgId: event.orgId,
          teamId: ticket.teamId,
          projectId: ticket.projectId,
          boardId: ticket.boardId,
          ticket: {
            id: ticket.id,
            key: ticket.key,
            title: ticket.title,
            priority: ticket.priority,
            url: `${appUrl}/?ticket=${ticket.id}`,
          },
          actor: actor ? { id: actor.id, name: actor.name } : null,
          ...(evName === "mention" ? { mentionDisplayNames } : {}),
        },
      };

      await db
        .insert(webhookDeliveries)
        .values({
          id: deliveryId,
          endpointId: ep.id,
          domainEventId: event.id,
          eventType: evName,
          idempotencyKey: `wh:${ep.id}:${event.id}:${evName}`,
          payload,
          status: "pending",
        })
        .onConflictDoNothing({ target: webhookDeliveries.idempotencyKey });
    }
  }
}

export async function deliverSingleWebhook(
  delivery: {
    id: string;
    endpointId: string;
    eventType: string;
    payload: Record<string, unknown>;
    attempts: number;
  },
  endpoint: typeof webhookEndpoints.$inferSelect,
  allowPrivateNetwork: boolean
): Promise<{ ok: boolean; statusCode: number; durationMs: number; error?: string }> {
  const target = await validateAndResolveWebhookTarget(endpoint.url, allowPrivateNetwork);
  const secret = decryptSetupToken({
    ciphertext: endpoint.secretCiphertext,
    iv: endpoint.secretIv,
    authTag: endpoint.secretAuthTag,
  });

  const body = formatWebhookBody(endpoint.format, delivery.payload);
  const ts = Math.floor(Date.now() / 1000);
  const sig = signWebhookPayload(secret, ts, body);

  return sendPinnedWebhookRequest({
    url: target.url,
    pinnedIp: target.pinnedIp,
    pinnedFamily: target.pinnedFamily,
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Patchwork-Event": delivery.eventType,
      "X-Patchwork-Delivery": delivery.id,
      "X-Patchwork-Timestamp": String(ts),
      "X-Patchwork-Signature": sig,
    },
  });
}

export async function processWebhookDeliveriesBatch(limit = 20): Promise<number> {
  const settings = await getSystemSetting("notifications");
  const client = await pool.connect();
  let rows: Array<{
    id: string;
    endpoint_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    attempts: number;
  }> = [];

  try {
    await client.query("BEGIN");
    const res = await client.query<{
      id: string;
      endpoint_id: string;
      event_type: string;
      payload: Record<string, unknown>;
      attempts: number;
    }>(
      `SELECT id, endpoint_id, event_type, payload, attempts
       FROM webhook_deliveries
       WHERE status IN ('pending', 'failed') AND next_attempt_at <= NOW()
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    rows = res.rows;

    for (const row of rows) {
      const [ep] = await db
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.id, row.endpoint_id))
        .limit(1);
      if (!ep || !ep.enabled) {
        await client.query(
          `UPDATE webhook_deliveries SET status = 'dead_letter', last_error = 'endpoint disabled' WHERE id = $1`,
          [row.id]
        );
        continue;
      }

      try {
        const result = await deliverSingleWebhook(
          {
            id: row.id,
            endpointId: row.endpoint_id,
            eventType: row.event_type,
            payload: row.payload || {},
            attempts: row.attempts,
          },
          ep,
          settings.allowPrivateNetworkWebhooks
        );

        if (result.ok) {
          await client.query(
            `UPDATE webhook_deliveries
             SET status = 'delivered', response_status = $2, duration_ms = $3,
                 delivered_at = NOW(), last_error = NULL
             WHERE id = $1`,
            [row.id, result.statusCode, result.durationMs]
          );
          await client.query(
            `UPDATE webhook_endpoints SET consecutive_failures = 0 WHERE id = $1`,
            [ep.id]
          );
        } else {
          throw new Error(result.error || `HTTP ${result.statusCode}`);
        }
      } catch (err) {
        const nextAttempts = row.attempts + 1;
        const msg = redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, 300);

        // Circuit breaker check
        const nextFailures = ep.consecutiveFailures + 1;
        if (nextFailures >= CIRCUIT_BREAKER_THRESHOLD) {
          await client.query(
            `UPDATE webhook_endpoints
             SET consecutive_failures = $2, enabled = false, disabled_at = NOW(),
                 disabled_reason = 'Auto-disabled after sustained delivery failures'
             WHERE id = $1`,
            [ep.id, nextFailures]
          );
        } else {
          await client.query(
            `UPDATE webhook_endpoints SET consecutive_failures = $2 WHERE id = $1`,
            [ep.id, nextFailures]
          );
        }

        if (nextAttempts >= MAX_WEBHOOK_ATTEMPTS) {
          await client.query(
            `UPDATE webhook_deliveries
             SET status = 'dead_letter', attempts = $2, last_error = $3
             WHERE id = $1`,
            [row.id, nextAttempts, msg]
          );
        } else {
          const delayMs =
            Math.min(2000 * 3 ** (nextAttempts - 1), 20 * 60 * 1000) +
            Math.floor(Math.random() * 3000);
          await client.query(
            `UPDATE webhook_deliveries
             SET status = 'failed', attempts = $2,
                 next_attempt_at = NOW() + ($3 || ' milliseconds')::interval,
                 last_error = $4
             WHERE id = $1`,
            [row.id, nextAttempts, String(delayMs), msg]
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

export async function sendTestWebhook(endpointId: string, orgId: string) {
  const [ep] = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.orgId, orgId)))
    .limit(1);
  if (!ep) throw new NotFoundError("Webhook endpoint not found");

  const settings = await getSystemSetting("notifications");
  const deliveryId = crypto.randomUUID();
  const payload = {
    version: 1,
    event: "webhook.test",
    deliveryId,
    timestamp: new Date().toISOString(),
    data: {
      orgId,
      message: "Patchwork test webhook delivery",
    },
  };

  const result = await deliverSingleWebhook(
    {
      id: deliveryId,
      endpointId: ep.id,
      eventType: "webhook.test",
      payload,
      attempts: 1,
    },
    ep,
    settings.allowPrivateNetworkWebhooks
  );

  await db.insert(webhookDeliveries).values({
    id: deliveryId,
    endpointId: ep.id,
    eventType: "webhook.test",
    idempotencyKey: `wh:test:${deliveryId}`,
    payload,
    status: result.ok ? "delivered" : "failed",
    attempts: 1,
    responseStatus: result.statusCode || null,
    durationMs: result.durationMs,
    lastError: result.error || null,
    deliveredAt: result.ok ? new Date() : null,
  });

  return result;
}

export async function listWebhookDeliveries(endpointId: string, limit = 50) {
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.endpointId, endpointId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(Math.min(limit, 200));

  return rows.map((r) => ({
    id: r.id,
    endpointId: r.endpointId,
    eventType: r.eventType,
    status: r.status,
    attempts: r.attempts,
    responseStatus: r.responseStatus,
    durationMs: r.durationMs,
    lastError: r.lastError ? redactSecrets(r.lastError) : null,
    deliveredAt: r.deliveredAt ? r.deliveredAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function cleanupWebhookDeliveryLogRetention(): Promise<void> {
  const settings = await getSystemSetting("notifications").catch(() => ({
    deliveryLogRetentionDays: 30,
  }));
  const days = settings.deliveryLogRetentionDays ?? 30;
  await pool.query(
    `DELETE FROM webhook_deliveries WHERE created_at < NOW() - ($1 || ' days')::interval`,
    [String(days)]
  );
}

setDomainEventWebhookHook(enqueueWebhooksForDomainEvent);
backgroundWorker.setWebhookBatchProcessor(() => processWebhookDeliveriesBatch(20));
backgroundWorker.registerMaintenanceTask(cleanupWebhookDeliveryLogRetention);
