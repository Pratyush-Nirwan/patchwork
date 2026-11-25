import crypto from "crypto";
import nodemailer from "nodemailer";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  emailOutbox,
  notifications,
  tickets,
  userNotificationPreferences,
  users,
} from "@/db/schema";
import { getSystemSetting } from "./settings";
import { decryptSetupToken, parseEncryptionKey } from "./setup-token";
import { canUserViewTicket, getUserNotificationPrefs } from "./watchers";
import { getAccessibleTeamIds } from "./rbac";
import { redactSecrets } from "./diagnostics";
import {
  backgroundWorker,
} from "./worker";
import { setNotificationEmailHook } from "./notifications";

const MAX_EMAIL_ATTEMPTS = 6;
const RATE_LIMIT_PER_HOUR = 20;

export function sanitizeEmailHeader(value: string): string {
  return value.replace(/[\r\n\x00-\x1f\x7f]/g, " ").trim();
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function maskEmailAddress(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const prefix = local.slice(0, Math.min(2, local.length));
  return `${prefix}***@${domain}`;
}

function getAppUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

function getUnsubscribeHmacKey(): Buffer {
  const base = parseEncryptionKey();
  try {
    return crypto.createHmac("sha256", base).update("patchwork-unsubscribe-v1").digest();
  } finally {
    base.fill(0);
  }
}

export type UnsubscribeCategory = "mention" | "assignment" | "watched_update" | "digest";

export function createUnsubscribeToken(input: {
  userId: string;
  category: UnsubscribeCategory;
  ttlMs?: number;
}): string {
  const exp = Date.now() + (input.ttlMs ?? 14 * 24 * 60 * 60 * 1000);
  const payload = Buffer.from(
    JSON.stringify({ uid: input.userId, cat: input.category, exp }),
    "utf8"
  ).toString("base64url");
  const key = getUnsubscribeHmacKey();
  try {
    const sig = crypto.createHmac("sha256", key).update(payload).digest("base64url");
    return `${payload}.${sig}`;
  } finally {
    key.fill(0);
  }
}

export function verifyUnsubscribeToken(
  token: string
): { userId: string; category: UnsubscribeCategory } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  const key = getUnsubscribeHmacKey();
  try {
    const expectedSig = crypto.createHmac("sha256", key).update(payload).digest("base64url");
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expectedSig, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      uid?: string;
      cat?: UnsubscribeCategory;
      exp?: number;
    };
    if (!parsed.uid || !parsed.cat || typeof parsed.exp !== "number") return null;
    if (Date.now() > parsed.exp) return null;
    if (!["mention", "assignment", "watched_update", "digest"].includes(parsed.cat)) {
      return null;
    }
    return { userId: parsed.uid, category: parsed.cat };
  } catch {
    return null;
  } finally {
    key.fill(0);
  }
}

async function createSmtpTransport() {
  const settings = await getSystemSetting("notifications");
  const smtp = settings.smtp;
  if (!smtp.enabled || !smtp.host || !smtp.fromAddress) {
    return null;
  }

  let pass: string | undefined;
  if (smtp.passwordCiphertext && smtp.passwordIv && smtp.passwordAuthTag) {
    pass = decryptSetupToken({
      ciphertext: smtp.passwordCiphertext,
      iv: smtp.passwordIv,
      authTag: smtp.passwordAuthTag,
    });
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.security === "tls",
    requireTLS: smtp.security === "starttls",
    ignoreTLS: smtp.security === "none",
    auth: smtp.username ? { user: smtp.username, pass: pass || "" } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  return { transporter, smtp, settings };
}

export async function sendTestEmail(toAddress: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const ctx = await createSmtpTransport();
    if (!ctx) {
      return { ok: false, error: "SMTP is disabled or missing host/from address." };
    }
    const fromName = sanitizeEmailHeader(ctx.smtp.fromName || "Patchwork");
    const fromAddr = sanitizeEmailHeader(ctx.smtp.fromAddress);
    const to = sanitizeEmailHeader(toAddress);

    await ctx.transporter.sendMail({
      from: `${fromName} <${fromAddr}>`,
      to,
      replyTo: ctx.smtp.replyTo ? sanitizeEmailHeader(ctx.smtp.replyTo) : undefined,
      subject: "Patchwork SMTP test email",
      text: `This is a test email from Patchwork (${getAppUrl()}). Your SMTP settings are working.`,
      html: `<p>This is a test email from <strong>Patchwork</strong> (<a href="${escapeHtml(getAppUrl())}">${escapeHtml(getAppUrl())}</a>). Your SMTP settings are working.</p>`,
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: redactSecrets(msg).slice(0, 300) };
  }
}

export async function enqueueImmediateEmailForNotification(input: {
  notificationId: string;
  recipientId: string;
  type: "mention" | "assignment" | "unassignment" | "watched_update";
  ticketId: string;
  commentId: string | null;
  actorId: string | null;
  snippet: string | null;
}): Promise<void> {
  if (input.type !== "mention" && input.type !== "assignment") return;

  const settings = await getSystemSetting("notifications");
  if (!settings.smtp.enabled || !settings.smtp.host || !settings.smtp.fromAddress) return;

  const [userRow] = await db
    .select({ id: users.id, isDeactivated: users.isDeactivated })
    .from(users)
    .where(eq(users.id, input.recipientId))
    .limit(1);
  if (!userRow || userRow.isDeactivated) return;

  const prefs = await getUserNotificationPrefs(input.recipientId);
  const mode = input.type === "mention" ? prefs.emailMentions : prefs.emailAssignments;
  if (mode !== "immediate") return;

  const [ticket] = await db
    .select({ key: tickets.key, title: tickets.title })
    .from(tickets)
    .where(eq(tickets.id, input.ticketId))
    .limit(1);
  if (!ticket) return;

  const actorRow = input.actorId
    ? (
        await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, input.actorId))
          .limit(1)
      )[0]
    : null;

  const actorName = sanitizeEmailHeader(actorRow?.name || "Someone");
  const subject =
    input.type === "mention"
      ? sanitizeEmailHeader(`[Patchwork] ${actorName} mentioned you in ${ticket.key}`)
      : sanitizeEmailHeader(`[Patchwork] ${actorName} assigned ${ticket.key} to you`);

  await db
    .insert(emailOutbox)
    .values({
      recipientId: input.recipientId,
      category: input.type,
      ticketId: input.ticketId,
      notificationIds: [input.notificationId],
      subject,
      payload: {
        ticketKey: ticket.key,
        ticketTitle: ticket.title,
        actorName,
        commentId: input.commentId,
        snippet: settings.includeTicketTextInEmails ? input.snippet : null,
      },
      idempotencyKey: `email:imm:${input.notificationId}`,
    })
    .onConflictDoNothing({ target: emailOutbox.idempotencyKey });
}

function buildEmailContent(input: {
  recipientId: string;
  category: string;
  ticketId: string | null;
  payload: Record<string, unknown>;
  includeTicketText: boolean;
}) {
  const appUrl = getAppUrl();
  const settingsUrl = `${appUrl}/`;
  const unsubCategory: UnsubscribeCategory =
    input.category === "digest"
      ? "digest"
      : input.category === "assignment"
      ? "assignment"
      : "mention";
  const unsubToken = createUnsubscribeToken({
    userId: input.recipientId,
    category: unsubCategory,
  });
  const unsubUrl = `${appUrl}/api/notifications/unsubscribe?token=${encodeURIComponent(unsubToken)}`;

  if (input.category === "digest") {
    const items = Array.isArray(input.payload.items)
      ? (input.payload.items as Array<{
          ticketId: string;
          ticketKey: string;
          ticketTitle: string;
          count: number;
        }>)
      : [];
    const textLines = [
      "Your Patchwork notification digest:",
      "",
      ...items.map(
        (it) => `- ${it.ticketKey}: ${it.ticketTitle} (${it.count} update${it.count === 1 ? "" : "s"}) — ${appUrl}/?ticket=${it.ticketId}`
      ),
      "",
      `Notification settings: ${settingsUrl}`,
      `Unsubscribe from digests: ${unsubUrl}`,
    ];
    const htmlItems = items
      .map(
        (it) =>
          `<li><a href="${escapeHtml(`${appUrl}/?ticket=${it.ticketId}`)}"><strong>${escapeHtml(it.ticketKey)}</strong>: ${escapeHtml(it.ticketTitle)}</a> (${it.count})</li>`
      )
      .join("");
    const html = `<div style="font-family:sans-serif;font-size:14px;color:#111">
      <p>Your <strong>Patchwork</strong> notification digest:</p>
      <ul>${htmlItems}</ul>
      <hr style="border:none;border-top:1px solid #ddd;margin:16px 0"/>
      <p style="font-size:12px;color:#666">
        <a href="${escapeHtml(settingsUrl)}">Notification settings</a> ·
        <a href="${escapeHtml(unsubUrl)}">Unsubscribe from digests</a>
      </p>
    </div>`;
    return { text: textLines.join("\n"), html };
  }

  const ticketKey = String(input.payload.ticketKey || "");
  const ticketTitle = String(input.payload.ticketTitle || "");
  const actorName = String(input.payload.actorName || "Someone");
  const commentId = typeof input.payload.commentId === "string" ? input.payload.commentId : null;
  const snippet =
    input.includeTicketText && typeof input.payload.snippet === "string"
      ? input.payload.snippet
      : null;

  const deepLink = input.ticketId
    ? `${appUrl}/?ticket=${encodeURIComponent(input.ticketId)}${
        commentId ? `&comment=${encodeURIComponent(commentId)}` : ""
      }`
    : appUrl;

  const headline =
    input.category === "mention"
      ? `${actorName} mentioned you in ${ticketKey}: ${ticketTitle}`
      : `${actorName} assigned ${ticketKey} to you: ${ticketTitle}`;

  const textParts = [headline];
  if (snippet) textParts.push("", `> ${snippet}`);
  textParts.push(
    "",
    `View ticket: ${deepLink}`,
    "",
    `Notification settings: ${settingsUrl}`,
    `Unsubscribe from ${unsubCategory} emails: ${unsubUrl}`
  );

  const html = `<div style="font-family:sans-serif;font-size:14px;color:#111">
    <p>${escapeHtml(headline)}</p>
    ${snippet ? `<blockquote style="border-left:3px solid #ccc;padding-left:10px;color:#444">${escapeHtml(snippet)}</blockquote>` : ""}
    <p><a href="${escapeHtml(deepLink)}">Open in Patchwork</a></p>
    <hr style="border:none;border-top:1px solid #ddd;margin:16px 0"/>
    <p style="font-size:12px;color:#666">
      <a href="${escapeHtml(settingsUrl)}">Notification settings</a> ·
      <a href="${escapeHtml(unsubUrl)}">Unsubscribe</a>
    </p>
  </div>`;

  return { text: textParts.join("\n"), html };
}

export async function processEmailOutboxBatch(limit = 20): Promise<number> {
  const ctx = await createSmtpTransport();
  if (!ctx) return 0;

  const client = await pool.connect();
  let rows: Array<{
    id: string;
    recipient_id: string;
    category: string;
    ticket_id: string | null;
    subject: string;
    payload: Record<string, unknown>;
    attempts: number;
  }> = [];

  try {
    await client.query("BEGIN");
    const res = await client.query<{
      id: string;
      recipient_id: string;
      category: string;
      ticket_id: string | null;
      subject: string;
      payload: Record<string, unknown>;
      attempts: number;
    }>(
      `SELECT id, recipient_id, category, ticket_id, subject, payload, attempts
       FROM email_outbox
       WHERE status = 'pending' AND next_attempt_at <= NOW()
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    rows = res.rows;

    for (const row of rows) {
      try {
        // Rate limit per recipient
        const rateRes = await client.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM email_outbox
           WHERE recipient_id = $1 AND status = 'sent' AND sent_at > NOW() - INTERVAL '1 hour'`,
          [row.recipient_id]
        );
        if (Number(rateRes.rows[0]?.cnt || 0) >= RATE_LIMIT_PER_HOUR) {
          await client.query(
            `UPDATE email_outbox SET next_attempt_at = NOW() + INTERVAL '5 minutes' WHERE id = $1`,
            [row.id]
          );
          continue;
        }

        const [recipient] = await db
          .select({ email: users.email, isDeactivated: users.isDeactivated })
          .from(users)
          .where(eq(users.id, row.recipient_id))
          .limit(1);
        if (!recipient || recipient.isDeactivated) {
          await client.query(
            `UPDATE email_outbox SET status = 'sent', sent_at = NOW(), last_error = 'recipient inactive' WHERE id = $1`,
            [row.id]
          );
          continue;
        }

        // Read-time access check for ticket-scoped emails
        if (row.ticket_id) {
          const [ticket] = await db
            .select({ orgId: tickets.orgId, teamId: tickets.teamId })
            .from(tickets)
            .where(eq(tickets.id, row.ticket_id))
            .limit(1);
          if (!ticket || !(await canUserViewTicket(row.recipient_id, ticket))) {
            await client.query(
              `UPDATE email_outbox SET status = 'sent', sent_at = NOW(), last_error = 'access revoked' WHERE id = $1`,
              [row.id]
            );
            continue;
          }
        }

        const content = buildEmailContent({
          recipientId: row.recipient_id,
          category: row.category,
          ticketId: row.ticket_id,
          payload: row.payload || {},
          includeTicketText: ctx.settings.includeTicketTextInEmails,
        });

        await ctx.transporter.sendMail({
          from: `${sanitizeEmailHeader(ctx.smtp.fromName || "Patchwork")} <${sanitizeEmailHeader(ctx.smtp.fromAddress)}>`,
          to: sanitizeEmailHeader(recipient.email),
          replyTo: ctx.smtp.replyTo ? sanitizeEmailHeader(ctx.smtp.replyTo) : undefined,
          subject: sanitizeEmailHeader(row.subject),
          text: content.text,
          html: content.html,
        });

        await client.query(
          `UPDATE email_outbox SET status = 'sent', sent_at = NOW(), last_error = NULL WHERE id = $1`,
          [row.id]
        );
      } catch (err) {
        const nextAttempts = row.attempts + 1;
        const msg = redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, 300);
        if (nextAttempts >= MAX_EMAIL_ATTEMPTS) {
          await client.query(
            `UPDATE email_outbox SET status = 'dead_letter', attempts = $2, last_error = $3 WHERE id = $1`,
            [row.id, nextAttempts, msg]
          );
        } else {
          const delayMs = Math.min(1000 * 2 ** nextAttempts, 15 * 60 * 1000) + Math.floor(Math.random() * 2000);
          await client.query(
            `UPDATE email_outbox
             SET attempts = $2,
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

export function getZonedDateParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const hourNum = Number(get("hour")) % 24;
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    hour: hourNum,
    weekday: weekdayMap[get("weekday")] ?? 0,
  };
}

export async function runDigestScheduler(now = new Date()): Promise<number> {
  const settings = await getSystemSetting("notifications");
  if (!settings.smtp.enabled || !settings.smtp.host || !settings.smtp.fromAddress) return 0;

  const tz = settings.defaultTimezone || "UTC";
  const local = getZonedDateParts(now, tz);

  const prefRows = await db
    .select({
      userId: userNotificationPreferences.userId,
      emailMentions: userNotificationPreferences.emailMentions,
      emailAssignments: userNotificationPreferences.emailAssignments,
      emailWatched: userNotificationPreferences.emailWatched,
      digestFrequency: userNotificationPreferences.digestFrequency,
      digestHour: userNotificationPreferences.digestHour,
      digestDay: userNotificationPreferences.digestDay,
      lastDigestSentAt: userNotificationPreferences.lastDigestSentAt,
    })
    .from(userNotificationPreferences)
    .innerJoin(users, eq(users.id, userNotificationPreferences.userId))
    .where(eq(users.isDeactivated, false));

  let enqueued = 0;

  for (const pref of prefRows) {
    const wantsDigest =
      pref.emailMentions === "digest" ||
      pref.emailAssignments === "digest" ||
      pref.emailWatched === "digest";
    if (!wantsDigest) continue;
    if (pref.digestHour !== local.hour) continue;
    if (pref.digestFrequency === "weekly" && pref.digestDay !== local.weekday) continue;

    if (pref.lastDigestSentAt) {
      const lastLocal = getZonedDateParts(new Date(pref.lastDigestSentAt), tz);
      if (lastLocal.dateKey === local.dateKey) continue;
    }

    const wantedTypes: Array<"mention" | "assignment" | "watched_update"> = [];
    if (pref.emailMentions === "digest") wantedTypes.push("mention");
    if (pref.emailAssignments === "digest") wantedTypes.push("assignment");
    if (pref.emailWatched === "digest") wantedTypes.push("watched_update");

    const since = pref.lastDigestSentAt
      ? new Date(pref.lastDigestSentAt)
      : new Date(now.getTime() - (pref.digestFrequency === "weekly" ? 7 : 1) * 24 * 60 * 60 * 1000);

    const accessibleTeamIds = new Set(await getAccessibleTeamIds(pref.userId));
    const unreadRows = await db
      .select({
        id: notifications.id,
        ticketId: notifications.ticketId,
        type: notifications.type,
        ticketKey: tickets.key,
        ticketTitle: tickets.title,
        teamId: tickets.teamId,
      })
      .from(notifications)
      .innerJoin(tickets, eq(tickets.id, notifications.ticketId))
      .where(
        and(
          eq(notifications.recipientId, pref.userId),
          inArray(notifications.type, wantedTypes),
          isNull(notifications.readAt),
          isNull(notifications.archivedAt),
          gte(notifications.createdAt, since)
        )
      );

    // Group by ticket & enforce read-time access
    const grouped = new Map<
      string,
      { ticketId: string; ticketKey: string; ticketTitle: string; count: number }
    >();
    const notifIds: string[] = [];

    for (const r of unreadRows) {
      if (!accessibleTeamIds.has(r.teamId)) continue;
      notifIds.push(r.id);
      const cur = grouped.get(r.ticketId);
      if (cur) cur.count += 1;
      else
        grouped.set(r.ticketId, {
          ticketId: r.ticketId,
          ticketKey: r.ticketKey,
          ticketTitle: r.ticketTitle,
          count: 1,
        });
    }

    // Skip empty digests
    if (grouped.size === 0) continue;

    await db
      .insert(emailOutbox)
      .values({
        recipientId: pref.userId,
        category: "digest",
        ticketId: null,
        notificationIds: notifIds,
        subject: sanitizeEmailHeader(
          `[Patchwork] Your ${pref.digestFrequency} notification digest (${notifIds.length})`
        ),
        payload: { items: [...grouped.values()] },
        idempotencyKey: `digest:${pref.userId}:${local.dateKey}`,
      })
      .onConflictDoNothing({ target: emailOutbox.idempotencyKey });

    await db
      .update(userNotificationPreferences)
      .set({ lastDigestSentAt: now })
      .where(eq(userNotificationPreferences.userId, pref.userId));

    enqueued += 1;
  }

  return enqueued;
}

export async function listEmailDeliveryLog(limit = 50) {
  const rows = await db
    .select({
      id: emailOutbox.id,
      recipientEmail: users.email,
      category: emailOutbox.category,
      status: emailOutbox.status,
      attempts: emailOutbox.attempts,
      lastError: emailOutbox.lastError,
      createdAt: emailOutbox.createdAt,
      sentAt: emailOutbox.sentAt,
    })
    .from(emailOutbox)
    .innerJoin(users, eq(users.id, emailOutbox.recipientId))
    .orderBy(desc(emailOutbox.createdAt))
    .limit(Math.min(limit, 200));

  return rows.map((r) => ({
    id: r.id,
    recipientMasked: maskEmailAddress(r.recipientEmail),
    category: r.category,
    status: r.status,
    attempts: r.attempts,
    lastError: r.lastError ? redactSecrets(r.lastError) : null,
    createdAt: r.createdAt.toISOString(),
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
  }));
}

export async function cleanupEmailDeliveryLogRetention(): Promise<void> {
  const settings = await getSystemSetting("notifications").catch(() => ({
    deliveryLogRetentionDays: 30,
  }));
  const days = settings.deliveryLogRetentionDays ?? 30;
  await pool.query(
    `DELETE FROM email_outbox WHERE created_at < NOW() - ($1 || ' days')::interval`,
    [String(days)]
  );
}

// Register email hooks with notification core & worker
setNotificationEmailHook(enqueueImmediateEmailForNotification);
backgroundWorker.setEmailBatchProcessor(() => processEmailOutboxBatch(20));
backgroundWorker.registerMaintenanceTask(() => runDigestScheduler().then(() => undefined));
backgroundWorker.registerMaintenanceTask(cleanupEmailDeliveryLogRetention);
