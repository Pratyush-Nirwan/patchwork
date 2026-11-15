import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import pg from "pg";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { searchWorkspace } from "../src/lib/search";

const DB_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test";
const S3_ENDPOINT = process.env.S3_ENDPOINT || "http://127.0.0.1:9000";
const S3_BUCKET = process.env.S3_BUCKET || "patchwork-test";

const pool = new pg.Pool({ connectionString: DB_URL });
const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" },
  forcePathStyle: true,
});

describe("Development Seeder Integration Suite", () => {
  beforeAll(async () => {
    // Reset test database and run seeder with small size
    execSync("node scripts/dev-minio.mjs && node scripts/reset-test-db.mjs", { stdio: "pipe" });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("refuses to run when NODE_ENV=production", () => {
    expect(() => {
      execSync("node scripts/seed.mjs --yes", {
        env: { ...process.env, NODE_ENV: "production", DATABASE_URL: DB_URL },
        stdio: "pipe",
      });
    }).toThrow();
  });

  it("refuses to run against non-localhost or unauthorized db without --force-dev", () => {
    expect(() => {
      execSync(
        "node scripts/seed.mjs --yes --database-url postgres://postgres:postgres@remote-server:5432/production_db",
        { stdio: "pipe" }
      );
    }).toThrow();

    expect(() => {
      execSync(
        "node scripts/seed.mjs --yes --database-url postgres://postgres:postgres@localhost:5432/unauthorized_db",
        { stdio: "pipe" }
      );
    }).toThrow();
  });

  it("seeds small volume with --reset and populates valid data across all tables", async () => {
    const out = execSync(
      `node scripts/seed.mjs --reset --size small --seed 42 --yes --database-url "${DB_URL}"`,
      { stdio: "pipe", encoding: "utf8" }
    );
    expect(out).toContain("Acme Corporation");
    expect(out).toContain("alex.chen@example.com");
    expect(out).toContain("DevPassword123!");

    // Verify Org
    const orgRes = await pool.query("SELECT * FROM orgs WHERE slug = 'acme-corp'");
    expect(orgRes.rows.length).toBe(1);
    const org = orgRes.rows[0];
    expect(org.name).toBe("Acme Corporation");

    // Verify Users & Emails (lowercase, reserved example domain, unique)
    const userRes = await pool.query("SELECT * FROM users WHERE email LIKE '%@example.%'");
    expect(userRes.rows.length).toBeGreaterThanOrEqual(10);
    const emails = userRes.rows.map((u) => u.email);
    for (const email of emails) {
      expect(email).toBe(email.toLowerCase());
      expect(/@(example\.com|example\.org|example\.net)$/.test(email)).toBe(true);
      expect(email.trim()).toBe(email);
    }
    const uniqueEmails = new Set(emails);
    expect(uniqueEmails.size).toBe(emails.length);

    // Verify Teams (at least 2 teams, at least one lead, member, viewer per team)
    const teamRes = await pool.query("SELECT * FROM teams WHERE org_id = $1", [org.id]);
    expect(teamRes.rows.length).toBeGreaterThanOrEqual(2);
    for (const team of teamRes.rows) {
      const tmRes = await pool.query("SELECT * FROM team_members WHERE team_id = $1", [team.id]);
      expect(tmRes.rows.length).toBeGreaterThanOrEqual(3);
      const roles = tmRes.rows.map((m) => m.role);
      expect(roles).toContain("lead");
      expect(roles).toContain("member");
      expect(roles).toContain("viewer");

      // Verify member sub-roles are strictly developer or tester
      const memberSubRoles = tmRes.rows
        .filter((m) => m.role === "member")
        .map((m) => m.sub_role);
      expect(memberSubRoles).toContain("developer");
      expect(memberSubRoles).toContain("tester");
      for (const sr of memberSubRoles) {
        expect(["developer", "tester"]).toContain(sr);
      }
    }

    // Verify Projects & sequential ticket counters
    const projRes = await pool.query("SELECT * FROM projects WHERE org_id = $1", [org.id]);
    expect(projRes.rows.length).toBeGreaterThanOrEqual(4);
    for (const proj of projRes.rows) {
      expect(/^[A-Z0-9]{2,5}$/.test(proj.key)).toBe(true);
      expect(proj.ticket_counter).toBeGreaterThan(0);

      // Verify tickets for project
      const ticketsRes = await pool.query(
        "SELECT * FROM tickets WHERE project_id = $1 ORDER BY number ASC",
        [proj.id]
      );
      expect(ticketsRes.rows.length).toBe(proj.ticket_counter);
      for (let i = 0; i < ticketsRes.rows.length; i++) {
        const t = ticketsRes.rows[i];
        expect(t.number).toBe(i + 1);
        expect(t.key).toBe(`${proj.key}-${i + 1}`);
        expect(t.created_at.getTime()).toBeLessThanOrEqual(t.updated_at.getTime());
        expect(t.created_at.getTime()).toBeLessThanOrEqual(Date.now());
      }

      // Verify calendar due dates: realistic mix of scheduled and unscheduled tickets
      const scheduledTickets = ticketsRes.rows.filter((t) => t.due_date !== null);
      const unscheduledTickets = ticketsRes.rows.filter((t) => t.due_date === null);
      expect(scheduledTickets.length).toBeGreaterThan(0);
      expect(unscheduledTickets.length).toBeGreaterThan(0);
    }

    // Verify assignees belong to the ticket's team
    const assigneesCheck = await pool.query(`
      SELECT t.id, t.assignee_id, t.team_id
      FROM tickets t
      WHERE t.assignee_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM team_members tm
          WHERE tm.team_id = t.team_id AND tm.user_id = t.assignee_id
        )
    `);
    expect(assigneesCheck.rows.length).toBe(0);

    // Verify activities match chronological order and no future dates
    const actRes = await pool.query("SELECT * FROM ticket_activities");
    expect(actRes.rows.length).toBeGreaterThan(50);
    for (const act of actRes.rows) {
      expect(act.created_at.getTime()).toBeLessThanOrEqual(Date.now());
    }

    // Verify external links have valid URLs and matching providers
    const linkRes = await pool.query("SELECT * FROM ticket_links");
    expect(linkRes.rows.length).toBeGreaterThanOrEqual(15);
    for (const link of linkRes.rows) {
      expect(/^(https:\/\/github\.com\/acme-example\/|https:\/\/gitlab\.com\/acme-example\/)/.test(link.url)).toBe(true);
      expect(["github", "gitlab"]).toContain(link.provider);
      expect(["pr", "mr", "issue", "commit"]).toContain(link.kind);
    }

    // Verify attachments exist in MinIO and have extracted text
    const attRes = await pool.query("SELECT * FROM ticket_attachments");
    expect(attRes.rows.length).toBeGreaterThanOrEqual(10);
    for (const att of attRes.rows) {
      expect(att.size_bytes).toBeGreaterThan(0);
      expect(att.storage_key).toContain(att.ticket_id);
      // Check MinIO object existence
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: S3_BUCKET, Key: att.storage_key })
      );
      expect(head.ContentLength).toBe(att.size_bytes);
    }

    // Verify setup completion
    const setupStateRes = await pool.query("SELECT * FROM setup_state WHERE id = 'default'");
    expect(setupStateRes.rows[0].is_completed).toBe(true);
    expect(setupStateRes.rows[0].current_step).toBe(7);

    const setupTokenRes = await pool.query("SELECT * FROM setup_token WHERE id = 'default'");
    expect(setupTokenRes.rows[0].consumed_at).not.toBeNull();
    expect(setupTokenRes.rows[0].ciphertext).toBeNull();
  });

  it("is idempotent: running without --reset does not duplicate rows", async () => {
    const beforeCountRes = await pool.query(`
      SELECT
        (SELECT count(*) FROM users) AS users,
        (SELECT count(*) FROM tickets) AS tickets,
        (SELECT count(*) FROM ticket_comments) AS comments,
        (SELECT count(*) FROM ticket_attachments) AS attachments
    `);
    const before = beforeCountRes.rows[0];

    const out = execSync(
      `node scripts/seed.mjs --size small --seed 42 --yes --database-url "${DB_URL}"`,
      { stdio: "pipe", encoding: "utf8" }
    );
    expect(out).toContain("Database is already seeded");

    const afterCountRes = await pool.query(`
      SELECT
        (SELECT count(*) FROM users) AS users,
        (SELECT count(*) FROM tickets) AS tickets,
        (SELECT count(*) FROM ticket_comments) AS comments,
        (SELECT count(*) FROM ticket_attachments) AS attachments
    `);
    const after = afterCountRes.rows[0];

    expect(after.users).toBe(before.users);
    expect(after.tickets).toBe(before.tickets);
    expect(after.comments).toBe(before.comments);
    expect(after.attachments).toBe(before.attachments);
  });

  it("yields identical results with the same --seed flag", async () => {
    execSync(
      `node scripts/seed.mjs --reset --size small --seed 99 --yes --database-url "${DB_URL}"`,
      { stdio: "pipe" }
    );
    const run1 = await pool.query("SELECT key, title FROM tickets ORDER BY key LIMIT 5");

    execSync(
      `node scripts/seed.mjs --reset --size small --seed 99 --yes --database-url "${DB_URL}"`,
      { stdio: "pipe" }
    );
    const run2 = await pool.query("SELECT key, title FROM tickets ORDER BY key LIMIT 5");

    expect(run2.rows).toEqual(run1.rows);
  });

  it("enables full-text search across seeded tickets, comments, and attachments", async () => {
    const adminRes = await pool.query("SELECT id FROM users WHERE email = 'alex.chen@example.com'");
    const adminId = adminRes.rows[0].id;

    // Search for keywords that exist in seeded tickets/attachments/comments
    const results = await searchWorkspace(adminId, "PostgreSQL OR cluster OR architecture OR Redis");
    expect(results.length).toBeGreaterThan(0);

    const kinds = new Set(results.map((r) => r.kind));
    expect(kinds.has("ticket") || kinds.has("comment") || kinds.has("attachment")).toBe(true);
  });
});
