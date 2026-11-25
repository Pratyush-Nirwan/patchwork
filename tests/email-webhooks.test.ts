import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
  userNotificationPreferences,
  webhookEndpoints,
} from "@/db/schema";
import { setSystemSetting, resetSystemSetting } from "@/lib/settings";
import {
  createUnsubscribeToken,
  escapeHtml,
  getZonedDateParts,
  listEmailDeliveryLog,
  maskEmailAddress,
  processEmailOutboxBatch,
  runDigestScheduler,
  sanitizeEmailHeader,
  sendTestEmail,
  verifyUnsubscribeToken,
} from "@/lib/email-notifications";
import {
  createWebhookEndpoint,
  deliverSingleWebhook,
  formatWebhookBody,
  rotateWebhookSecret,
  signWebhookPayload,
  validateAndResolveWebhookTarget,
} from "@/lib/webhooks";
import { createTicket } from "@/lib/tickets";
import { addComment } from "@/lib/comments";
import { backgroundWorker } from "@/lib/worker";

function startLocalSmtpStub(): Promise<{
  port: number;
  received: string[];
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const received: string[] = [];
    const server = net.createServer((socket) => {
      let inData = false;
      let buf = "";
      socket.write("220 localhost ESMTP PatchworkTest\r\n");
      socket.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        if (inData) {
          buf += text;
          if (buf.includes("\r\n.\r\n")) {
            received.push(buf);
            buf = "";
            inData = false;
            socket.write("250 2.0.0 Ok\r\n");
          }
          return;
        }
        const upper = text.trim().toUpperCase();
        if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
          socket.write("250-localhost\r\n250 OK\r\n");
        } else if (upper.startsWith("MAIL FROM") || upper.startsWith("RCPT TO")) {
          socket.write("250 2.1.0 Ok\r\n");
        } else if (upper.startsWith("DATA")) {
          inData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (upper.startsWith("QUIT")) {
          socket.write("221 Bye\r\n");
          socket.end();
        } else {
          socket.write("250 Ok\r\n");
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        port: addr.port,
        received,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

function startLocalWebhookReceiver(): Promise<{
  port: number;
  requests: Array<{ headers: http.IncomingHttpHeaders; body: string }>;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const requests: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c.toString("utf8")));
      req.on("end", () => {
        requests.push({ headers: req.headers, body });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        port: addr.port,
        requests,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

describe("Step 5 & 6: Email, Webhooks, and SSRF Protections", () => {
  let smtpStub: Awaited<ReturnType<typeof startLocalSmtpStub>>;
  let webhookStub: Awaited<ReturnType<typeof startLocalWebhookReceiver>>;
  let orgId: string;
  let teamId: string;
  let boardId: string;
  let aliceId: string;
  let bobId: string;

  beforeAll(async () => {
    process.env.TOKEN_ENCRYPTION_KEY =
      process.env.TOKEN_ENCRYPTION_KEY ||
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    await ensureMigrated();
    smtpStub = await startLocalSmtpStub();
    webhookStub = await startLocalWebhookReceiver();

    const uid = crypto.randomUUID().slice(0, 8);
    const [a] = await db
      .insert(users)
      .values({ email: `ew-alice-${uid}@example.com`, name: "Alice EW", passwordHash: "hash" })
      .returning();
    const [b] = await db
      .insert(users)
      .values({ email: `ew-bob-${uid}@example.com`, name: "Bob EW", passwordHash: "hash" })
      .returning();
    aliceId = a.id;
    bobId = b.id;

    const [o] = await db
      .insert(orgs)
      .values({ name: `EW Org ${uid}`, slug: `ew-org-${uid}`, createdById: aliceId })
      .returning();
    orgId = o.id;
    await db.insert(orgMembers).values([
      { orgId, userId: aliceId, role: "admin" },
      { orgId, userId: bobId, role: "member" },
    ]);

    const [t] = await db
      .insert(teams)
      .values({ orgId, name: "EWTeam", slug: `ew-team-${uid}` })
      .returning();
    teamId = t.id;
    await db.insert(teamMembers).values([
      { teamId, userId: aliceId, role: "lead" },
      { teamId, userId: bobId, role: "member" },
    ]);

    const [p] = await db
      .insert(projects)
      .values({ orgId, teamId, name: "EWProj", key: `EW${uid.slice(0, 3).toUpperCase()}` })
      .returning();
    const [brd] = await db
      .insert(boards)
      .values({ orgId, teamId, projectId: p.id, name: "Board" })
      .returning();
    boardId = brd.id;
    await db.insert(columns).values({ boardId, name: "Backlog", position: 0 });
  });

  afterAll(async () => {
    await resetSystemSetting("notifications").catch(() => undefined);
    await smtpStub.close();
    await webhookStub.close();
  });

  it("sanitizes email headers, escapes HTML, and verifies signed single-purpose unsubscribe tokens", () => {
    expect(sanitizeEmailHeader("Hello\r\nBcc: evil@attacker.com")).toBe("Hello  Bcc: evil@attacker.com");
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
    );
    expect(maskEmailAddress("alice@example.com")).toBe("al***@example.com");

    const tok = createUnsubscribeToken({ userId: bobId, category: "mention" });
    const verified = verifyUnsubscribeToken(tok);
    expect(verified).toEqual({ userId: bobId, category: "mention" });

    // Tampered token fails
    expect(verifyUnsubscribeToken(tok.slice(0, -4) + "AAAA")).toBeNull();
    // Expired token fails
    const expired = createUnsubscribeToken({ userId: bobId, category: "digest", ttlMs: -1000 });
    expect(verifyUnsubscribeToken(expired)).toBeNull();
  });

  it("sends test email and immediate mention email via local SMTP stub + handles DST timezones", async () => {
    await setSystemSetting("notifications", {
      defaultTimezone: "America/New_York",
      smtp: {
        enabled: true,
        host: "127.0.0.1",
        port: smtpStub.port,
        security: "none",
        username: "",
        fromName: "Patchwork Test",
        fromAddress: "noreply@patchwork.local",
        replyTo: "",
      },
    });

    const testRes = await sendTestEmail("bob@example.com");
    expect(testRes.ok).toBe(true);
    expect(smtpStub.received.length).toBe(1);

    const ticket = await createTicket(aliceId, boardId, { title: "Email outbox ticket" });
    await addComment(aliceId, ticket.id, { body: `Ping @[Bob EW](mention:${bobId})` });
    await backgroundWorker.processDomainEventsBatch(50);
    await processEmailOutboxBatch(20);

    expect(smtpStub.received.length).toBeGreaterThanOrEqual(2);
    const logs = await listEmailDeliveryLog(20);
    expect(logs.some((l) => l.status === "sent" && l.recipientMasked.includes("***@"))).toBe(true);

    // DST check: America/New_York winter vs summer
    const winter = getZonedDateParts(new Date("2026-01-15T14:00:00Z"), "America/New_York");
    const summer = getZonedDateParts(new Date("2026-07-15T14:00:00Z"), "America/New_York");
    expect(winter.hour).toBe(9);
    expect(summer.hour).toBe(10);

    // Empty digest is skipped
    await db
      .insert(userNotificationPreferences)
      .values({ userId: aliceId, emailWatched: "digest", digestHour: summer.hour })
      .onConflictDoNothing();
    const digests = await runDigestScheduler(new Date("2026-07-15T14:00:00Z"));
    expect(digests).toBe(0);
  });

  it("blocks SSRF targets (loopback, private, metadata, IPv6, decimal/octal) unless explicitly allowed", async () => {
    const blockedUrls = [
      "http://example.com/hook", // HTTP blocked when private disabled
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://172.16.0.1/hook",
      "https://192.168.1.1/hook",
      "https://169.254.169.254/latest/meta-data/",
      "https://[::1]/hook",
      "https://[::ffff:127.0.0.1]/hook",
      "https://[fe80::1]/hook",
      "https://2130706433/hook", // decimal 127.0.0.1
      "https://0177.0.0.1/hook", // octal 127.0.0.1
      "https://user:pass@example.com/hook",
    ];
    for (const u of blockedUrls) {
      await expect(validateAndResolveWebhookTarget(u, false)).rejects.toThrow();
    }

    // Allowed when allowPrivateNetwork = true
    const allowed = await validateAndResolveWebhookTarget(
      `http://127.0.0.1:${webhookStub.port}/hook`,
      true
    );
    expect(allowed.pinnedIp).toBe("127.0.0.1");
  });

  it("signs webhook payloads accurately, formats Slack/Discord/Mattermost/Generic, and rotates secrets", async () => {
    await setSystemSetting("notifications", {
      allowPrivateNetworkWebhooks: true,
    });

    const created = await createWebhookEndpoint(orgId, aliceId, {
      name: "Local Test Hook",
      url: `http://127.0.0.1:${webhookStub.port}/webhook`,
      format: "generic",
      events: ["ticket.created", "comment.created", "mention"],
    });
    expect(created.secret).toMatch(/^whsec_/);

    const [epRow] = await db
      .select()
      .from(webhookEndpoints)
      .where(
        (await import("drizzle-orm")).eq(webhookEndpoints.id, created.endpoint.id)
      )
      .limit(1);

    const genericPayload = {
      version: 1,
      event: "ticket.created",
      deliveryId: "del-123",
      timestamp: new Date().toISOString(),
      data: {
        ticket: { id: "t1", key: "EW-1", title: "Test", url: "http://localhost:3000/?ticket=t1" },
        actor: { id: aliceId, name: "Alice EW" },
      },
    };

    const res = await deliverSingleWebhook(
      {
        id: "del-123",
        endpointId: epRow.id,
        eventType: "ticket.created",
        payload: genericPayload,
        attempts: 1,
      },
      epRow,
      true
    );
    expect(res.ok).toBe(true);
    expect(webhookStub.requests.length).toBe(1);

    const req = webhookStub.requests[0];
    const ts = Number(req.headers["x-patchwork-timestamp"]);
    const expectedSig = signWebhookPayload(created.secret, ts, req.body);
    expect(req.headers["x-patchwork-signature"]).toBe(expectedSig);

    // Format shapes
    const slackBody = JSON.parse(formatWebhookBody("slack", genericPayload));
    expect(slackBody.text).toContain("EW-1");
    const discordBody = JSON.parse(formatWebhookBody("discord", genericPayload));
    expect(discordBody.embeds[0].title).toContain("EW-1");
    const mmBody = JSON.parse(formatWebhookBody("mattermost", genericPayload));
    expect(mmBody.username).toBe("Patchwork");

    // Rotate secret
    const rotated = await rotateWebhookSecret(epRow.id, orgId);
    expect(rotated.secret).not.toBe(created.secret);
  });
});
