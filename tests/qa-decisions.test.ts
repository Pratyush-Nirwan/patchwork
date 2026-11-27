import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db, ensureMigrated } from "@/db";
import { sessions, orgs, orgMembers, teams, projects, boards, columns, tickets } from "@/db/schema";
import {
  registerUser,
  createSession,
  validateSessionTokenDetailed,
} from "@/lib/auth";
import { requireRequestAuth } from "@/lib/http";
import {
  SecuritySettingsSchema,
  getSystemSetting,
  setSystemSetting,
  resetSystemSetting,
} from "@/lib/settings";
import {
  createPresignedUploadUrl,
  getAttachmentDownloadUrl,
  ensureS3BucketExists,
} from "@/lib/attachments";
import {
  generateCaddyfileContent,
  generateNginxConfContent,
  buildDomainSetupGuide,
  handleDomainConfiguration,
} from "../scripts/setup/domain.mjs";

describe("QA Open Decisions (QA-10 & QA-11)", () => {
  let testUserId: string;
  let testOrgId: string;
  let testTicketId: string;

  beforeAll(async () => {
    await ensureMigrated();
    const email = `qa-decisions-${Date.now()}@example.com`;
    const auth = await registerUser({
      email,
      password: "StrongPassword123!",
      name: "QA Decisions User",
    });
    testUserId = auth.user.id;

    const [org] = await db
      .insert(orgs)
      .values({
        name: "QA Decisions Org",
        slug: `qa-decisions-org-${Date.now()}`,
        createdById: testUserId,
      })
      .returning();
    testOrgId = org.id;

    await db.insert(orgMembers).values({
      orgId: testOrgId,
      userId: testUserId,
      role: "admin",
    });

    const [team] = await db
      .insert(teams)
      .values({
        orgId: testOrgId,
        name: "Core",
        slug: `core-${Date.now()}`,
      })
      .returning();

    const [project] = await db
      .insert(projects)
      .values({
        orgId: testOrgId,
        teamId: team.id,
        name: "QA Project",
        key: "QAD",
      })
      .returning();

    const [board] = await db
      .insert(boards)
      .values({
        orgId: testOrgId,
        teamId: team.id,
        projectId: project.id,
        name: "Main Board",
      })
      .returning();

    const [col] = await db
      .insert(columns)
      .values({
        boardId: board.id,
        name: "Todo",
        position: 0,
      })
      .returning();

    const [ticket] = await db
      .insert(tickets)
      .values({
        orgId: testOrgId,
        teamId: team.id,
        projectId: project.id,
        boardId: board.id,
        columnId: col.id,
        number: 1,
        key: `QAD-${Date.now().toString().slice(-4)}`,
        title: "QA Decisions Ticket",
        reporterId: testUserId,
        position: 0,
      })
      .returning();
    testTicketId = ticket.id;
  });

  afterAll(async () => {
    await resetSystemSetting("security", testUserId).catch(() => undefined);
  });

  describe("Decision 1 (QA-10): Session idle timeout", () => {
    it("validates allowed sessionIdleTimeoutMs range in SecuritySettingsSchema", () => {
      const defaults = SecuritySettingsSchema.parse({});
      expect(defaults.sessionIdleTimeoutMs).toBe(0);
      expect(defaults.sessionLifetimeMs).toBe(1000 * 60 * 60 * 24 * 7);

      expect(
        SecuritySettingsSchema.safeParse({ sessionIdleTimeoutMs: 60_000 }).success
      ).toBe(true);
      expect(
        SecuritySettingsSchema.safeParse({ sessionIdleTimeoutMs: 30 * 24 * 60 * 60 * 1000 })
          .success
      ).toBe(true);
      expect(
        SecuritySettingsSchema.safeParse({ sessionIdleTimeoutMs: 15_000 }).success
      ).toBe(false);
      expect(
        SecuritySettingsSchema.safeParse({ sessionIdleTimeoutMs: -1 }).success
      ).toBe(false);
    });

    it("expires idle sessions, throttles last_active_at writes, respects skipTouch, and applies setting changes without restart", async () => {
      const currentSec = await getSystemSetting("security");
      await setSystemSetting(
        "security",
        {
          ...currentSec,
          sessionIdleTimeoutMs: 120_000, // 2 minutes
        },
        testUserId
      );

      const session = await createSession(testUserId);
      const [initialRow] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, session.id));
      expect(initialRow.lastActiveAt).toBeInstanceOf(Date);

      // Set last_active_at to 70s ago (within 120s timeout, past 60s throttle)
      const seventySecondsAgo = new Date(Date.now() - 70_000);
      await db
        .update(sessions)
        .set({ lastActiveAt: seventySecondsAgo })
        .where(eq(sessions.id, session.id));

      // skipTouch: true (used by SSE / auth-check) must NOT update last_active_at
      const sseCheck = await validateSessionTokenDetailed(session.id, {
        skipTouch: true,
      });
      expect(sseCheck.auth).not.toBeNull();
      const [afterSse] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, session.id));
      expect(afterSse.lastActiveAt.getTime()).toBe(seventySecondsAgo.getTime());

      // Normal request extends last_active_at because > 60s elapsed
      const activeCheck = await validateSessionTokenDetailed(session.id);
      expect(activeCheck.auth).not.toBeNull();
      const [afterActive] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, session.id));
      expect(afterActive.lastActiveAt.getTime()).toBeGreaterThan(
        seventySecondsAgo.getTime()
      );

      // Immediate second request within 60s is throttled (no DB write)
      const secondCheck = await validateSessionTokenDetailed(session.id);
      expect(secondCheck.auth).not.toBeNull();
      const [afterSecond] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, session.id));
      expect(afterSecond.lastActiveAt.getTime()).toBe(
        afterActive.lastActiveAt.getTime()
      );

      // Setting change applies immediately without restart: tighten to 60s and age session by 65s
      await setSystemSetting(
        "security",
        {
          ...currentSec,
          sessionIdleTimeoutMs: 60_000,
        },
        testUserId
      );
      await db
        .update(sessions)
        .set({ lastActiveAt: new Date(Date.now() - 65_000) })
        .where(eq(sessions.id, session.id));

      const req = new NextRequest("http://localhost:3000/api/workspace", {
        headers: {
          cookie: `patchwork_session=${session.id}`,
        },
      });
      await expect(requireRequestAuth(req)).rejects.toMatchObject({
        status: 401,
        code: "SESSION_IDLE_EXPIRED",
        message: "Your session expired due to inactivity",
      });

      // Expired session was deleted
      const remaining = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, session.id));
      expect(remaining).toHaveLength(0);
    });

    it("keeps total session lifetime separate from idle timeout", async () => {
      const currentSec = await getSystemSetting("security");
      await setSystemSetting(
        "security",
        {
          ...currentSec,
          sessionIdleTimeoutMs: 300_000, // 5 min idle
        },
        testUserId
      );

      const session = await createSession(testUserId);
      // Recent activity, but total lifetime expired
      await db
        .update(sessions)
        .set({
          lastActiveAt: new Date(),
          expiresAt: new Date(Date.now() - 5_000),
        })
        .where(eq(sessions.id, session.id));

      const res = await validateSessionTokenDetailed(session.id);
      expect(res.auth).toBeNull();
      expect(res.reason).toBe("invalid");
    });
  });

  describe("Decision 2 (QA-11): Dedicated MinIO host & MINIO_PUBLIC_URL", () => {
    it("removes /s3/ rewrites and configures dedicated files.<domain> host in proxy templates & docs", async () => {
      const caddy = generateCaddyfileContent({
        domain: "tickets.example.com",
        appPort: 3000,
        minioPort: 9000,
      });
      expect(caddy).not.toContain("/s3/");
      expect(caddy).toContain("files.tickets.example.com");
      expect(caddy).toContain("reverse_proxy 127.0.0.1:9000");

      const nginx = generateNginxConfContent({
        domain: "tickets.example.com",
        appPort: 3000,
        minioPort: 9000,
      });
      expect(nginx).not.toContain("/s3/");
      expect(nginx).toContain("server_name files.tickets.example.com;");
      expect(nginx).toContain("proxy_set_header Host $http_host;");
      expect(nginx).toContain("proxy_buffering off;");
      expect(nginx).toContain("client_max_body_size 20M;");
      expect(nginx).toContain("proxy_http_version 1.1;");
      expect(nginx).toContain("proxy_read_timeout 86400s;");

      const guide = buildDomainSetupGuide({
        domain: "tickets.example.com",
        publicUrl: "https://tickets.example.com",
        publicIp: "203.0.113.10",
        appPort: 3000,
        minioPort: 9000,
        proxyType: "nginx",
      });
      expect(guide).not.toContain("/s3/");
      expect(guide).toContain("files.tickets.example.com");
      expect(guide).toContain("MINIO_PUBLIC_URL=https://files.tickets.example.com");

      const res = await handleDomainConfiguration({
        choice: "no",
        publicUrl: undefined,
        minioPort: 9000,
      });
      expect(res.minioPublicUrl).toBe("http://localhost:9000");

      const staticCaddy = fs.readFileSync(
        path.join(process.cwd(), "deploy", "Caddyfile"),
        "utf8"
      );
      const staticNginx = fs.readFileSync(
        path.join(process.cwd(), "deploy", "nginx.conf"),
        "utf8"
      );
      const envExample = fs.readFileSync(
        path.join(process.cwd(), ".env.example"),
        "utf8"
      );

      expect(staticCaddy).not.toContain("/s3/");
      expect(staticCaddy).toContain("files.patchwork.example.com");
      expect(staticNginx).not.toContain("/s3/");
      expect(staticNginx).toContain("server_name files.patchwork.example.com;");
      expect(staticNginx).toContain("proxy_set_header Host $http_host;");
      expect(envExample).toContain("MINIO_PUBLIC_URL=http://localhost:9000");
    });

    it("signs presigned upload/download URLs with MINIO_PUBLIC_URL and round-trips through a Host-preserving proxy", async () => {
      const prevPublicUrl = process.env.MINIO_PUBLIC_URL;

      try {
        process.env.MINIO_PUBLIC_URL = "https://files.example.com";
        const { uploadUrl: prodUrl } = await createPresignedUploadUrl(
          testUserId,
          testTicketId,
          {
            filename: "spec.txt",
            contentType: "text/plain",
            sizeBytes: 12,
          }
        );
        expect(prodUrl.startsWith("https://files.example.com/")).toBe(true);

        // Start a local HTTP reverse proxy forwarding Host header & path unmodified to MinIO (127.0.0.1:9000)
        await ensureS3BucketExists();
        const minioTarget = new URL(
          process.env.S3_ENDPOINT || "http://127.0.0.1:9000"
        );

        const proxyServer = http.createServer((clientReq, clientRes) => {
          const proxyReq = http.request(
            {
              hostname: minioTarget.hostname,
              port: Number(minioTarget.port || 9000),
              path: clientReq.url,
              method: clientReq.method,
              headers: {
                ...clientReq.headers,
                host: clientReq.headers.host,
              },
            },
            (proxyRes) => {
              clientRes.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
              proxyRes.pipe(clientRes);
            }
          );
          proxyReq.on("error", (err) => {
            clientRes.writeHead(502);
            clientRes.end(err.message);
          });
          clientReq.pipe(proxyReq);
        });

        await new Promise<void>((resolve) => {
          proxyServer.listen(0, "127.0.0.1", () => resolve());
        });

        try {
          const addr = proxyServer.address();
          const port = typeof addr === "object" && addr ? addr.port : 0;
          process.env.MINIO_PUBLIC_URL = `http://127.0.0.1:${port}`;

          const { uploadUrl, storageKey } = await createPresignedUploadUrl(
            testUserId,
            testTicketId,
            {
              filename: "roundtrip.txt",
              contentType: "text/plain",
              sizeBytes: 19,
            }
          );
          expect(uploadUrl.startsWith(`http://127.0.0.1:${port}/`)).toBe(true);

          const payload = "hello-minio-proxy!\n";
          const putRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Type": "text/plain",
            },
            body: payload,
          });
          expect(putRes.status).toBe(200);

          // Insert attachment row to test getAttachmentDownloadUrl against the same proxy
          const { ticketAttachments } = await import("@/db/schema");
          const [att] = await db
            .insert(ticketAttachments)
            .values({
              ticketId: testTicketId,
              orgId: testOrgId,
              teamId: (
                await db.select().from(tickets).where(eq(tickets.id, testTicketId))
              )[0].teamId,
              uploaderId: testUserId,
              filename: "roundtrip.txt",
              contentType: "text/plain",
              sizeBytes: payload.length,
              storageKey,
              extractedText: payload,
            })
            .returning();

          const downloadUrl = await getAttachmentDownloadUrl(testUserId, att.id);
          expect(downloadUrl.startsWith(`http://127.0.0.1:${port}/`)).toBe(true);

          const getRes = await fetch(downloadUrl);
          expect(getRes.status).toBe(200);
          const downloadedText = await getRes.text();
          expect(downloadedText).toBe(payload);
        } finally {
          await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
        }
      } finally {
        if (prevPublicUrl === undefined) {
          delete process.env.MINIO_PUBLIC_URL;
        } else {
          process.env.MINIO_PUBLIC_URL = prevPublicUrl;
        }
      }
    });
  });
});
