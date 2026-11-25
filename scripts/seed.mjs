#!/usr/bin/env node
import crypto from "crypto";
import { parseArgs } from "util";
import pg from "pg";
import dotenv from "dotenv";
import argon2 from "argon2";
import { faker } from "@faker-js/faker";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";

// Parse CLI flags
const { values: flags } = parseArgs({
  options: {
    reset: { type: "boolean", default: false },
    size: { type: "string", default: "medium" },
    seed: { type: "string", default: "42" },
    "setup-complete": { type: "boolean", default: true },
    "no-setup-complete": { type: "boolean", default: false },
    "no-attachments": { type: "boolean", default: false },
    "force-dev": { type: "boolean", default: false },
    "database-url": { type: "string", default: "" },
    yes: { type: "boolean", short: "y", default: false },
    env: { type: "string", default: "" },
  },
  allowPositionals: true,
});

if (flags.env) {
  dotenv.config({ path: flags.env, override: true });
} else {
  dotenv.config({ path: ".env" });
  dotenv.config({ path: ".env.local" });
}

// 1. Refuse production run
if (process.env.NODE_ENV === "production") {
  console.error("Error: Seeding is development-only and refused when NODE_ENV=production.");
  process.exit(1);
}

const rawDbUrl =
  flags["database-url"] ||
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/patchwork";

let parsedDbUrl;
try {
  parsedDbUrl = new URL(rawDbUrl);
} catch {
  console.error("Error: Invalid DATABASE_URL:", rawDbUrl);
  process.exit(1);
}

const dbHost = parsedDbUrl.hostname || "localhost";
const dbPort = parsedDbUrl.port || "5432";
const dbName = parsedDbUrl.pathname.replace(/^\//, "");

const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(dbHost);
const isAllowedDb = ["patchwork", "patchwork_test"].includes(dbName);

if (!flags["force-dev"]) {
  if (!isLocalhost) {
    console.error(
      `Error: Refused to seed non-localhost database host "${dbHost}". Use --force-dev to bypass.`
    );
    process.exit(1);
  }
  if (!isAllowedDb) {
    console.error(
      `Error: Refused to seed database "${dbName}". Allowed dev databases: patchwork, patchwork_test. Use --force-dev to bypass.`
    );
    process.exit(1);
  }
}

// Interactive confirmation in TTY
const isTTY = Boolean(process.stdin.isTTY && !flags.yes && !process.env.CI);
if (isTTY) {
  let clack;
  try {
    clack = await import("@clack/prompts");
  } catch {}

  if (clack) {
    clack.intro("Patchwork Development Database Seeder");
    if (flags.reset) {
      const confirmReset = await clack.confirm({
        message: `WARNING: --reset will purge existing seed data in "${dbName}" and MinIO. Continue?`,
        initialValue: false,
      });
      if (!confirmReset || clack.isCancel(confirmReset)) {
        clack.cancel("Seeding canceled.");
        process.exit(0);
      }
    }

    const confirmSeed = await clack.confirm({
      message: `Target database: "${dbName}" (${dbHost}:${dbPort}). Proceed with seeding?`,
      initialValue: true,
    });
    if (!confirmSeed || clack.isCancel(confirmSeed)) {
      clack.cancel("Seeding canceled.");
      process.exit(0);
    }
  }
}

// 2. Deterministic PRNG setup
const seedNumber = parseInt(flags.seed, 10) || 42;
faker.seed(seedNumber);

function createRng(seed) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = createRng(seedNumber);

function choice(arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// S3 / MinIO client
const s3Endpoint = process.env.S3_ENDPOINT || "http://127.0.0.1:9000";
const s3Region = process.env.S3_REGION || "us-east-1";
let s3Bucket = process.env.S3_BUCKET || "patchwork";
if (dbName === "patchwork_test" && (!process.env.S3_BUCKET || process.env.S3_BUCKET === "patchwork")) {
  s3Bucket = "patchwork-test";
}
const s3AccessKey = process.env.S3_ACCESS_KEY || "minioadmin";
const s3SecretKey = process.env.S3_SECRET_KEY || "minioadmin";

const s3 = new S3Client({
  endpoint: s3Endpoint,
  region: s3Region,
  credentials: {
    accessKeyId: s3AccessKey,
    secretAccessKey: s3SecretKey,
  },
  forcePathStyle: true,
});

async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: s3Bucket }));
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: s3Bucket }));
    } catch {}
  }
}

async function deleteMinioObjects(keys) {
  if (!keys || keys.length === 0) return;
  try {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: s3Bucket,
        Delete: { Objects: keys.map((k) => ({ Key: k })), Quiet: true },
      })
    );
  } catch {}
}

async function deleteOrgMinioObjects(orgId) {
  try {
    const listRes = await s3.send(
      new ListObjectsV2Command({
        Bucket: s3Bucket,
        Prefix: `${orgId}/`,
      })
    );
    if (listRes.Contents && listRes.Contents.length > 0) {
      await deleteMinioObjects(listRes.Contents.map((c) => c.Key).filter(Boolean));
    }
  } catch {}
}

// Helper to create simple valid PDF buffer
function createPdfBuffer(title, content) {
  const cleanTitle = title.replace(/[()\\]/g, "");
  const cleanContent = content.slice(0, 150).replace(/[()\\]/g, "");
  const streamText = `BT\n/F1 16 Tf\n50 720 Td\n(${cleanTitle}) Tj\n/F1 10 Tf\n0 -25 Td\n(${cleanContent}) Tj\nET`;
  const streamLen = Buffer.byteLength(streamText);
  const pdfString = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj
4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
5 0 obj << /Length ${streamLen} >> stream
${streamText}
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000318 00000 n 
trailer << /Root 1 0 R /Size 6 >>
startxref
${400 + streamLen}
%%EOF`;
  return Buffer.from(pdfString, "utf8");
}

const PNG_1X1_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

async function extractText(filename, contentType, buffer) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf") || contentType === "application/pdf") {
    try {
      const pdfParseModule = await import("pdf-parse");
      const pdfParse = pdfParseModule.default || pdfParseModule;
      const parsed = await pdfParse(buffer);
      if (parsed?.text) return parsed.text.trim().slice(0, 100000);
    } catch {}
    const raw = buffer.toString("latin1");
    const matches = Array.from(raw.matchAll(/\(([^()\\]{2,})\)/g)).map((m) => m[1]);
    return matches.join(" ").slice(0, 100000);
  }
  if (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    lower.endsWith(".log") ||
    lower.endsWith(".md") ||
    lower.endsWith(".json") ||
    lower.endsWith(".txt")
  ) {
    return buffer.toString("utf8").slice(0, 100000);
  }
  return "";
}

// Sizing configuration
const size = flags.size.toLowerCase();
const SIZES = {
  small: {
    userCount: 10,
    teamCount: 2,
    projectsPerTeam: 2,
    ticketsPerProject: 12,
    commentsPerTicket: 2,
    attachmentCount: 10,
    linkCount: 15,
  },
  medium: {
    userCount: 25,
    teamCount: 4,
    projectsPerTeam: 2, // 2-3 per team -> 10 projects
    ticketsPerProject: 15, // ~150 tickets
    commentsPerTicket: 2.5, // ~380 comments
    attachmentCount: 30,
    linkCount: 50,
  },
  large: {
    userCount: 50,
    teamCount: 6,
    projectsPerTeam: 3, // 18 projects
    ticketsPerProject: 25, // ~450 tickets
    commentsPerTicket: 2.5, // ~1100 comments
    attachmentCount: 90,
    linkCount: 150,
  },
};
const config = SIZES[size] || SIZES.medium;

// Connect to PostgreSQL
const pool = new pg.Pool({ connectionString: rawDbUrl });
const client = await pool.connect();

const SHARED_DEV_PASSWORD = "DevPassword123!";
const ORG_SLUG = "acme-corp";
let uploadedS3Keys = [];

try {
  // Check idempotency: does the org already exist?
  const existingOrgRes = await client.query(
    `SELECT id, name FROM orgs WHERE slug = $1`,
    [ORG_SLUG]
  );
  const orgExists = existingOrgRes.rows.length > 0;
  const existingOrgId = orgExists ? existingOrgRes.rows[0].id : null;

  if (orgExists && !flags.reset) {
    // Check if tickets need due_date update for the calendar feature
    const nullDueDateRes = await client.query(
      `SELECT count(*) as count FROM tickets WHERE org_id = $1 AND due_date IS NULL`,
      [existingOrgId]
    );
    const nullCount = Number(nullDueDateRes.rows[0].count);
    const totalTicketsRes = await client.query(
      `SELECT count(*) as count FROM tickets WHERE org_id = $1`,
      [existingOrgId]
    );
    const totalCount = Number(totalTicketsRes.rows[0].count);

    if (totalCount > 0 && nullCount === totalCount) {
      console.log(`\n📅 Detected ${totalCount} existing tickets without due dates. Backfilling calendar seed data...`);
      const existingTickets = await client.query(
        `SELECT id, number FROM tickets WHERE org_id = $1 ORDER BY number ASC`,
        [existingOrgId]
      );
      const now = new Date();
      const baseToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 0, 0);

      for (let i = 0; i < existingTickets.rows.length; i++) {
        const row = existingTickets.rows[i];
        const tNum = row.number || (i + 1);
        let dueDate = null;

        if (tNum % 5 === 0) {
          dueDate = null; // Unscheduled tray
        } else if (tNum % 12 === 1) {
          dueDate = new Date(baseToday.getTime()); // Today
        } else if (tNum % 12 === 2) {
          dueDate = new Date(baseToday.getTime() + 1 * 86400000); // Tomorrow
        } else if (tNum % 8 === 3) {
          const pastDays = (tNum % 5) + 1;
          dueDate = new Date(baseToday.getTime() - pastDays * 86400000); // Overdue
        } else if (tNum % 7 === 4) {
          dueDate = new Date(baseToday.getTime() + 3 * 86400000); // Clustered for +N more
        } else if (tNum % 7 === 5) {
          dueDate = new Date(baseToday.getTime() + 5 * 86400000); // Clustered for +N more
        } else if (tNum % 10 === 6) {
          dueDate = new Date(baseToday.getTime() + (32 + (tNum % 10)) * 86400000); // Next month
        } else {
          const offset = ((tNum * 3) % 25) + 2;
          dueDate = new Date(baseToday.getTime() + offset * 86400000);
        }

        if (dueDate) {
          await client.query(`UPDATE tickets SET due_date = $1 WHERE id = $2`, [dueDate, row.id]);
        }
      }
      console.log(`✔ Successfully backfilled calendar due dates for ${totalCount} existing tickets.`);
    }

    // Normalize any legacy sub-roles (designer, devops, general) to developer
    await client.query(`
      UPDATE team_members
      SET sub_role = 'developer'
      WHERE sub_role NOT IN ('developer', 'tester') AND role = 'member'
    `);

    // Already seeded - report existing rows and exit cleanly
    const statsRes = await client.query(`
      SELECT
        (SELECT count(*) FROM orgs WHERE slug = '${ORG_SLUG}') AS orgs,
        (SELECT count(*) FROM teams WHERE org_id = '${existingOrgId}') AS teams,
        (SELECT count(*) FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@example.org' OR email LIKE '%@example.net') AS users,
        (SELECT count(*) FROM projects WHERE org_id = '${existingOrgId}') AS projects,
        (SELECT count(*) FROM boards WHERE org_id = '${existingOrgId}') AS boards,
        (SELECT count(*) FROM columns WHERE board_id IN (SELECT id FROM boards WHERE org_id = '${existingOrgId}')) AS columns,
        (SELECT count(*) FROM tickets WHERE org_id = '${existingOrgId}') AS tickets,
        (SELECT count(*) FROM ticket_comments WHERE org_id = '${existingOrgId}') AS comments,
        (SELECT count(*) FROM ticket_activities WHERE ticket_id IN (SELECT id FROM tickets WHERE org_id = '${existingOrgId}')) AS activities,
        (SELECT count(*) FROM ticket_attachments WHERE org_id = '${existingOrgId}') AS attachments,
        (SELECT count(*) FROM ticket_links WHERE ticket_id IN (SELECT id FROM tickets WHERE org_id = '${existingOrgId}')) AS links
    `);
    const s = statsRes.rows[0];

    console.log(`\n✔ Database is already seeded. (Use --reset to re-seed)\n`);
    printSummaryTable({
      orgs: Number(s.orgs),
      teams: Number(s.teams),
      users: Number(s.users),
      projects: Number(s.projects),
      boards: Number(s.boards),
      columns: Number(s.columns),
      tickets: Number(s.tickets),
      comments: Number(s.comments),
      activities: Number(s.activities),
      attachments: Number(s.attachments),
      links: Number(s.links),
      minioUploaded: 0,
      dbName,
      dbHost,
      dbPort,
      seedNumber,
      adminEmail: "alex.chen@example.com",
      password: SHARED_DEV_PASSWORD,
    });
    process.exit(0);
  }

  // BEGIN TRANSACTION
  await client.query("BEGIN");

  // Track uploaded S3 keys for rollback if anything fails
  uploadedS3Keys = [];

  if (flags.reset && orgExists) {
    // Delete MinIO objects for this org
    await deleteOrgMinioObjects(existingOrgId);
    // Delete org (cascades to teams, team_members, projects, boards, columns, tickets, etc.)
    await client.query(`DELETE FROM orgs WHERE id = $1`, [existingOrgId]);
    // Delete seed users
    await client.query(
      `DELETE FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@example.org' OR email LIKE '%@example.net'`
    );
  }

  if (!flags["no-attachments"]) {
    await ensureBucket();
  }

  // Pre-hash password once
  const passwordHash = await argon2.hash(SHARED_DEV_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  // 1. Generate Users
  const RESERVED_DOMAINS = ["example.com", "example.org", "example.net"];
  const usersList = [];
  const usedEmails = new Set();

  // Admin user
  const adminUser = {
    id: crypto.randomUUID(),
    email: "alex.chen@example.com",
    name: "Alex Chen",
    passwordHash,
    mustChangePassword: false,
    isSetupAdmin: true,
    createdAt: new Date(Date.now() - 90 * 24 * 3600 * 1000),
  };
  usersList.push(adminUser);
  usedEmails.add(adminUser.email);

  const FIRST_NAMES = [
    "Sarah", "Marcus", "Elena", "Liam", "Priya", "Dmitri", "Aaliyah", "Carlos",
    "Fatima", "Kenji", "Hanna", "David", "Amara", "Tariq", "Zoe", "Viktor",
    "Mei", "Mateo", "Ingrid", "Devon", "Chloe", "Kofi", "Anya", "Julian",
    "Siddharth", "Nadia", "Lucas", "Maya", "Gabriel", "Lina", "Arjun", "Kai"
  ];
  const LAST_NAMES = [
    "Jenkins", "Vance", "Rostova", "Gallagher", "Sharma", "Petrov", "Farah",
    "Morales", "Al-Mansoor", "Takahashi", "Lindqvist", "Kowalski", "Okonkwo",
    "Haddad", "Novak", "Ilyin", "Zhang", "Navarro", "Berg", "Sinclair",
    "Sterling", "Mensah", "Volkov", "Mercer", "Rao", "Kasim", "Silva", "Gupta"
  ];

  for (let i = 1; i < config.userCount; i++) {
    const fn = choice(FIRST_NAMES);
    const ln = choice(LAST_NAMES);
    const name = `${fn} ${ln}`;
    const domain = choice(RESERVED_DOMAINS);
    let email = `${fn.toLowerCase()}.${ln.toLowerCase()}@${domain}`;
    let counter = 1;
    while (usedEmails.has(email)) {
      email = `${fn.toLowerCase()}.${ln.toLowerCase()}${counter++}@${domain}`;
    }
    usedEmails.add(email);

    const daysAgo = randInt(70, 90);
    const createdAt = new Date(Date.now() - daysAgo * 24 * 3600 * 1000);

    usersList.push({
      id: crypto.randomUUID(),
      email,
      name,
      passwordHash,
      mustChangePassword: false,
      isSetupAdmin: false,
      createdAt,
    });
  }

  // Insert users
  for (const u of usersList) {
    await client.query(
      `INSERT INTO users (id, email, name, password_hash, must_change_password, is_setup_admin, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [u.id, u.email, u.name, u.passwordHash, u.mustChangePassword, u.isSetupAdmin, u.createdAt]
    );
  }

  // 2. Generate Org
  const orgId = crypto.randomUUID();
  const orgName = "Acme Corporation";
  const orgCreatedAt = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  await client.query(
    `INSERT INTO orgs (id, name, slug, description, created_by_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      orgId,
      orgName,
      ORG_SLUG,
      "Enterprise software engineering, multi-cloud platforms, and core product services.",
      adminUser.id,
      orgCreatedAt,
    ]
  );

  // 3. Org Members
  for (const u of usersList) {
    await client.query(
      `INSERT INTO org_members (id, org_id, user_id, role, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        crypto.randomUUID(),
        orgId,
        u.id,
        u.id === adminUser.id ? "admin" : "member",
        u.createdAt,
      ]
    );
  }

  // 4. Teams & Team Memberships
  const ALL_TEAMS = [
    {
      name: "Platform Infrastructure",
      slug: "platform-infra",
      description: "Cloud automation, Kubernetes orchestration, and developer runtime environments.",
      wipLimit: true,
      projects: [
        { name: "Cloud Infrastructure & IaC", key: "INFRA" },
        { name: "Kubernetes Cluster Fleet", key: "K8S" },
      ],
    },
    {
      name: "Core Services & API",
      slug: "core-services",
      description: "High-throughput API gateway, microservice backend, and business domain engines.",
      wipLimit: false,
      projects: [
        { name: "Gateway & Routing Engine", key: "API" },
        { name: "Authentication & Identity", key: "AUTH" },
        { name: "Payments & Subscription Billing", key: "PAY" },
      ],
    },
    {
      name: "Web Frontend",
      slug: "web-frontend",
      description: "Customer-facing Next.js dashboard, design systems, and responsive applications.",
      wipLimit: false,
      projects: [
        { name: "Customer Web Application", key: "WEB" },
        { name: "Design System & Rayden UI", key: "DESIGN" },
      ],
    },
    {
      name: "Data & Analytics",
      slug: "data-analytics",
      description: "Streaming pipelines, Kafka ingestion, ETL transforms, and ML inference.",
      wipLimit: false,
      projects: [
        { name: "Event Ingestion & ETL", key: "DATA" },
        { name: "Metrics & Time-Series Engine", key: "METRIC" },
        { name: "Model Serving Pipeline", key: "ML" },
      ],
    },
    {
      name: "Security & Compliance",
      slug: "sec-ops",
      description: "Threat detection, vulnerability scanning, and SOC2 audit compliance.",
      wipLimit: false,
      projects: [
        { name: "Vulnerability Scanner", key: "SEC" },
        { name: "Audit Trail & Compliance", key: "AUDIT" },
      ],
    },
    {
      name: "Mobile Engineering",
      slug: "mobile-apps",
      description: "iOS and Android client applications with offline sync and push notifications.",
      wipLimit: false,
      projects: [
        { name: "iOS Native Client", key: "IOS" },
        { name: "Android Client App", key: "AND" },
      ],
    },
  ];

  const teamsToSeed = ALL_TEAMS.slice(0, config.teamCount);
  const seededTeams = [];

  // Partition users across teams (every team has 1 lead, >=1 member, >=1 viewer)
  const remainingUsers = usersList.filter((u) => u.id !== adminUser.id);
  const usersPerTeam = Math.floor(remainingUsers.length / teamsToSeed.length);

  let userIdx = 0;
  for (let tIdx = 0; tIdx < teamsToSeed.length; tIdx++) {
    const tDef = teamsToSeed[tIdx];
    const teamId = crypto.randomUUID();
    const teamCreatedAt = new Date(Date.now() - 85 * 24 * 3600 * 1000);

    await client.query(
      `INSERT INTO teams (id, org_id, name, slug, description, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [teamId, orgId, tDef.name, tDef.slug, tDef.description, teamCreatedAt]
    );

    // Assign members to team
    const teamMembersList = [];
    const count =
      tIdx === teamsToSeed.length - 1
        ? remainingUsers.length - userIdx
        : usersPerTeam;
    const assignedUsers = remainingUsers.slice(userIdx, userIdx + count);
    userIdx += count;

    // Ensure admin is also in team 0 as member
    if (tIdx === 0) {
      assignedUsers.push(adminUser);
    }

    // Role assignment: first is lead, second is viewer, others are members
    const memberSubRoles = ["developer", "tester", "designer", "devops", "general"];
    // Role assignment: first is lead, second is viewer, others are strictly developer or tester
    for (let mIdx = 0; mIdx < assignedUsers.length; mIdx++) {
      const u = assignedUsers[mIdx];
      let role = "member";
      let subRole = null;
      if (mIdx === 0) {
        role = "lead";
      } else if (mIdx === 1) {
        role = "viewer";
      } else if (mIdx === 2) {
        role = "member";
        subRole = "developer";
      } else if (mIdx === 3) {
        role = "member";
        subRole = "tester";
      } else {
        role = "member";
        subRole = memberSubRoles[(mIdx - 2) % memberSubRoles.length];
        subRole = mIdx % 3 === 0 ? "tester" : "developer";
      }

      await client.query(
        `INSERT INTO team_members (id, team_id, user_id, role, sub_role, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [crypto.randomUUID(), teamId, u.id, role, subRole, u.createdAt]
      );
      teamMembersList.push({ user: u, role, subRole });
    }

    seededTeams.push({
      id: teamId,
      orgId,
      name: tDef.name,
      slug: tDef.slug,
      wipLimit: tDef.wipLimit,
      projectDefs: tDef.projects,
      members: teamMembersList,
      createdAt: teamCreatedAt,
    });
  }

  // 5. Projects, Boards & Columns
  const seededBoards = [];
  const seededProjects = [];

  for (const team of seededTeams) {
    for (const pDef of team.projectDefs) {
      const projectId = crypto.randomUUID();
      const projectCreatedAt = new Date(Date.now() - 80 * 24 * 3600 * 1000);

      await client.query(
        `INSERT INTO projects (id, org_id, team_id, name, key, description, ticket_counter, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          projectId,
          orgId,
          team.id,
          pDef.name,
          pDef.key,
          `Active sprint board and backlog for ${pDef.name}.`,
          0,
          projectCreatedAt,
        ]
      );

      // Create Board for project
      const boardId = crypto.randomUUID();
      await client.query(
        `INSERT INTO boards (id, org_id, team_id, project_id, name, description, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          boardId,
          orgId,
          team.id,
          projectId,
          `${pDef.name} Kanban`,
          `Main kanban workflow for ${pDef.key}.`,
          projectCreatedAt,
        ]
      );

      // Columns on board
      const columnDefs = [
        { name: "Backlog", pos: 1000, color: "#475569", wip: null },
        { name: "New", pos: 2000, color: "#0284C7", wip: null },
        {
          name: "In Progress",
          pos: 3000,
          color: "#D97706",
          wip: team.wipLimit ? 4 : null,
        },
        {
          name: "In Review",
          pos: 4000,
          color: "#7C3AED",
          wip: team.wipLimit ? 2 : null,
        },
        { name: "QA", pos: 5000, color: "#059669", wip: null },
        { name: "Done", pos: 6000, color: "#16A34A", wip: null },
      ];

      const boardColumns = [];
      for (const col of columnDefs) {
        const colId = crypto.randomUUID();
        await client.query(
          `INSERT INTO columns (id, board_id, name, position, wip_limit, color, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [colId, boardId, col.name, col.pos, col.wip, col.color, projectCreatedAt]
        );
        boardColumns.push({ id: colId, name: col.name, pos: col.pos });
      }

      const pObj = {
        id: projectId,
        orgId,
        teamId: team.id,
        name: pDef.name,
        key: pDef.key,
        boardId,
        columns: boardColumns,
        teamMembers: team.members,
        ticketCount: 0,
      };

      seededProjects.push(pObj);
      seededBoards.push({ id: boardId, project: pObj, columns: boardColumns });
    }
  }

  // 6. Tickets
  const TICKET_TEMPLATES = [
    {
      title: "Migrate Redis session cache to distributed sentinel cluster",
      desc: "### Architecture Change\nMigrate Redis standalone cache to three-node cluster.\n\n- [x] Provision sentinel nodes\n- [ ] Update client pool timeout\n- [ ] Run failover simulation\n\n```yaml\nredis:\n  cluster: true\n  timeout: 2500ms\n```",
      labels: ["infra", "performance", "backend"],
      priority: "high",
    },
    {
      title: "Fix race condition in optimistic ticket column reordering",
      desc: "Rapid drag events in Kanban board cause stale state reconciliations when network latency spikes.\n\n### Repro Steps\n1. Move column left then right rapidly\n2. Observe position collision\n\nFix by applying fractional index recalculation.",
      labels: ["bug", "frontend"],
      priority: "urgent",
    },
    {
      title: "Implement exponential backoff for external webhook retries",
      desc: "Webhook deliveries currently fail permanently on 503 HTTP responses.\n\n> Add exponential jitter backoff: 1s, 4s, 16s, 64s with dead letter queue on 5th failure.",
      labels: ["api", "backend", "reliability"],
      priority: "medium",
    },
    {
      title: "Add GIN index for full-text search on attachment extracted text",
      desc: "PostgreSQL FTS queries on `ticket_attachments` require a weighted tsvector GIN index.\n\n```sql\nCREATE INDEX tickets_search_idx ON tickets USING gin(search_vector);\n```",
      labels: ["database", "performance"],
      priority: "high",
    },
    {
      title: "Refactor auth middleware to eliminate redundant token decryption",
      desc: "Session validation decrypts CSRF token twice per request lifecycle. Cache decrypted payload on request context.",
      labels: ["security", "tech-debt"],
      priority: "medium",
    },
    {
      title: "Audit MinIO presigned URL expiration windows and S3 ACLs",
      desc: "Ensure presigned download URLs expire strictly within 900 seconds. Verify private bucket ACL enforcement.",
      labels: ["security", "infra"],
      priority: "high",
    },
    {
      title: "Support dark mode contrast ratios for WCAG 2.2 AA compliance",
      desc: "Color contrast for muted badge text falls below 4.5:1 ratio on OLED displays.\n\n- [x] Audit badge tokens\n- [x] Adjust text-muted hex\n- [ ] Run Axe accessibility scanner",
      labels: ["frontend", "accessibility"],
      priority: "low",
    },
    {
      title: "Implement PostgreSQL LISTEN/NOTIFY heartbeat for idle connections",
      desc: "Long-lived SSE connections drop silently after 15 minutes of proxy inactivity.\n\nSend periodic ping frame every 30 seconds to keep connection alive.",
      labels: ["backend", "realtime"],
      priority: "medium",
    },
    {
      title: "Add rate limiting header checks for tenant API consumption",
      desc: "Standardize `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `Retry-After` headers across all endpoints.",
      labels: ["api", "docs"],
      priority: "low",
    },
    {
      title: "Standardize CSV employee import error reporting with line numbers",
      desc: "Show clear table report highlighting skipped duplicate rows with exact CSV line numbers and rejection reasons.",
      labels: ["frontend", "ux"],
      priority: "none",
    },
  ];

  const seededTickets = [];
  const seededComments = [];
  const seededActivities = [];
  const seededAttachments = [];
  const seededLinks = [];

  for (const project of seededProjects) {
    const numTickets = config.ticketsPerProject;
    for (let tNum = 1; tNum <= numTickets; tNum++) {
      const template = TICKET_TEMPLATES[(tNum - 1) % TICKET_TEMPLATES.length];
      const ticketId = crypto.randomUUID();
      const ticketKey = `${project.key}-${tNum}`;

      // Pick column
      const colRand = rng();
      let colIdx = 0;
      if (colRand < 0.25) colIdx = 5; // Done
      else if (colRand < 0.50) colIdx = 2; // In Progress
      else if (colRand < 0.70) colIdx = 0; // Backlog
      else if (colRand < 0.85) colIdx = 3; // In Review
      else if (colRand < 0.95) colIdx = 1; // New
      else colIdx = 4; // QA
      const targetColumn = project.columns[colIdx];

      // Assignee (15% unassigned)
      const isUnassigned = rng() < 0.15;
      const eligibleAssignees = project.teamMembers.map((m) => m.user);
      const assignee = isUnassigned ? null : choice(eligibleAssignees);
      const reporter = choice(eligibleAssignees);

      // Prioritized date in business hours within last 75 days
      const daysAgo = randInt(2, 75);
      const hour = randInt(9, 17);
      const min = randInt(0, 59);
      const createdDate = new Date(Date.now() - (daysAgo * 24 * 3600 + hour * 3600 + min * 60) * 1000);
      const updatedDate = new Date(createdDate.getTime() + randInt(1, 24) * 3600 * 1000);

      // Varied priority
      const pR = rng();
      let priority = template.priority;
      if (pR < 0.10) priority = "urgent";
      else if (pR < 0.35) priority = "high";
      else if (pR < 0.75) priority = "medium";
      else if (pR < 0.90) priority = "low";
      else priority = "none";

      const labels = template.labels;
      const labelsText = labels.join(" ");

      // Calendar-optimized due dates:
      // - ~20% unscheduled (null) for the unscheduled backlog tray
      // - Dedicated tickets for Today (0 days offset)
      // - Dedicated tickets for Tomorrow (+1 day)
      // - Overdue tickets (-1 to -5 days in past)
      // - Clustered tickets on specific days (+3 days, +5 days) to test "+N more" badge and popup
      // - Spread across current month (+2 to +25 days) and next month (+32 to +42 days)
      const now = new Date();
      const baseToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 0, 0);
      let dueDate = null;

      if (tNum % 5 === 0) {
        // Unscheduled backlog tray
        dueDate = null;
      } else if (tNum % 12 === 1) {
        // Due today!
        dueDate = new Date(baseToday.getTime());
      } else if (tNum % 12 === 2) {
        // Due tomorrow
        dueDate = new Date(baseToday.getTime() + 1 * 86400000);
      } else if (tNum % 8 === 3) {
        // Overdue (1 to 5 days in past)
        const pastDays = (tNum % 5) + 1;
        dueDate = new Date(baseToday.getTime() - pastDays * 86400000);
      } else if (tNum % 7 === 4) {
        // Clustered day (+3 days) to demonstrate "+N more" overflow
        dueDate = new Date(baseToday.getTime() + 3 * 86400000);
      } else if (tNum % 7 === 5) {
        // Clustered day (+5 days) to demonstrate "+N more" overflow
        dueDate = new Date(baseToday.getTime() + 5 * 86400000);
      } else if (tNum % 10 === 6) {
        // Next month (+32 to +40 days)
        dueDate = new Date(baseToday.getTime() + (32 + (tNum % 10)) * 86400000);
      } else {
        // General current month spread
        const offset = ((tNum * 3) % 25) + 2;
        dueDate = new Date(baseToday.getTime() + offset * 86400000);
      }

      await client.query(
        `INSERT INTO tickets (
          id, org_id, team_id, project_id, board_id, column_id,
          number, key, title, description, priority, labels, labels_text,
          assignee_id, reporter_id, due_date, position, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
        )`,
        [
          ticketId,
          orgId,
          project.teamId,
          project.id,
          project.boardId,
          targetColumn.id,
          tNum,
          ticketKey,
          `${template.title} #${tNum}`,
          `${template.desc}\n\n**Environment**: production\n**Reported**: ${createdDate.toISOString().slice(0, 10)}`,
          priority,
          labels,
          labelsText,
          assignee?.id ?? null,
          reporter.id,
          dueDate,
          tNum * 1000,
          createdDate,
          updatedDate,
        ]
      );

      const ticketObj = {
        id: ticketId,
        orgId,
        teamId: project.teamId,
        projectId: project.id,
        boardId: project.boardId,
        columnId: targetColumn.id,
        number: tNum,
        key: ticketKey,
        title: `${template.title} #${tNum}`,
        assignee,
        reporter,
        dueDate,
        createdAt: createdDate,
        updatedAt: updatedDate,
      };
      seededTickets.push(ticketObj);

      // Activities: created
      await client.query(
        `INSERT INTO ticket_activities (id, ticket_id, actor_id, action, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          crypto.randomUUID(),
          ticketId,
          reporter.id,
          "ticket.created",
          JSON.stringify({ title: ticketObj.title, priority }),
          createdDate,
        ]
      );
      seededActivities.push(1);

      // Activities: assigned
      if (assignee) {
        const assignDate = new Date(createdDate.getTime() + 1800 * 1000);
        await client.query(
          `INSERT INTO ticket_activities (id, ticket_id, actor_id, action, details, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            crypto.randomUUID(),
            ticketId,
            reporter.id,
            "ticket.assigned",
            JSON.stringify({ assigneeId: assignee.id, assigneeName: assignee.name }),
            assignDate,
          ]
        );
        seededActivities.push(1);
      }

      // Activities: moved to current column
      if (targetColumn.name !== "Backlog") {
        const moveDate = new Date(createdDate.getTime() + 7200 * 1000);
        await client.query(
          `INSERT INTO ticket_activities (id, ticket_id, actor_id, action, details, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            crypto.randomUUID(),
            ticketId,
            assignee?.id ?? reporter.id,
            "ticket.moved",
            JSON.stringify({
              fromColumnName: "Backlog",
              toColumnName: targetColumn.name,
              toColumnId: targetColumn.id,
            }),
            moveDate,
          ]
        );
        seededActivities.push(1);
      }
    }

    // Update project ticket counter
    await client.query(
      `UPDATE projects SET ticket_counter = $1 WHERE id = $2`,
      [numTickets, project.id]
    );
  }

  // 7. Ticket Comments
  const COMMENT_SNIPPETS = [
    "Reproduced this on staging environment with concurrency=25. Verified lock contention.",
    "Drafted PR with initial fix and added regression unit tests in Vitest.",
    "Code review approved. Benchmark shows 40% reduction in query latency.",
    "Deployed to canary cluster. Monitoring APM error budget for 30 minutes.",
    "Verified in production. Closing ticket as resolved.",
    "Database migration applied cleanly without table locking.",
    "Updated technical documentation and runbook with the troubleshooting steps.",
  ];

  for (const ticket of seededTickets) {
    const numComments = randInt(1, 4); // 1 to 4 comments -> 300 to 500 total
    for (let c = 0; c < numComments; c++) {
      const commentId = crypto.randomUUID();
      const author = choice(
        usersList.filter((u) => u.id !== ticket.reporter.id)
      ) || ticket.reporter;
      const commentDate = new Date(
        ticket.createdAt.getTime() + (c + 1) * 3600 * 1000
      );
      const body = choice(COMMENT_SNIPPETS);

      await client.query(
        `INSERT INTO ticket_comments (id, ticket_id, org_id, team_id, author_id, body, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          commentId,
          ticket.id,
          ticket.orgId,
          ticket.teamId,
          author.id,
          body,
          commentDate,
          commentDate,
        ]
      );
      seededComments.push(commentId);

      // Activity for comment
      await client.query(
        `INSERT INTO ticket_activities (id, ticket_id, actor_id, action, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          crypto.randomUUID(),
          ticket.id,
          author.id,
          "comment.added",
          JSON.stringify({ commentId, preview: body.slice(0, 100) }),
          commentDate,
        ]
      );
      seededActivities.push(1);
    }
  }

  // 8. Attachments
  let uploadedMinioCount = 0;
  if (!flags["no-attachments"]) {
    const ATTACHMENT_SPECS = [
      {
        filename: "error-stack-trace.log",
        contentType: "text/plain",
        generator: () =>
          Buffer.from(
            `Error: ConnectionPoolExhausted\n  at pg.Pool.connect (/app/node_modules/pg/lib/pool.js:45:11)\n  at searchWorkspace (/app/src/lib/search.ts:32:19)\nTimestamp: 2026-11-10T14:22:00Z`,
            "utf8"
          ),
      },
      {
        filename: "database-architecture.md",
        contentType: "text/markdown",
        generator: () =>
          Buffer.from(
            `# Architecture Specification\n\n- PostgreSQL 18 with tsvector full-text search\n- AES-256-GCM encrypted single-use setup tokens\n- MinIO S3-compatible attachment storage`,
            "utf8"
          ),
      },
      {
        filename: "benchmark-metrics.json",
        contentType: "application/json",
        generator: () =>
          Buffer.from(
            JSON.stringify(
              {
                throughputRps: 4250,
                latencyP95Ms: 14.2,
                errorRatePercent: 0.001,
                activeConnections: 32,
              },
              null,
              2
            ),
            "utf8"
          ),
      },
      {
        filename: "audit-report.pdf",
        contentType: "application/pdf",
        generator: () =>
          createPdfBuffer(
            "Patchwork Security & Architecture Audit Report",
            "Executive Summary: All RBAC hierarchy scopes, argon2 password hashing, and token rate limits meet SOC2 standards."
          ),
      },
      {
        filename: "diagram-preview.png",
        contentType: "image/png",
        generator: () => PNG_1X1_BUFFER,
      },
    ];

    const attachmentTickets = seededTickets.slice(0, config.attachmentCount);
    for (let aIdx = 0; aIdx < attachmentTickets.length; aIdx++) {
      const ticket = attachmentTickets[aIdx];
      const spec = ATTACHMENT_SPECS[aIdx % ATTACHMENT_SPECS.length];
      const buffer = spec.generator();
      const storageKey = `${ticket.orgId}/${ticket.teamId}/${ticket.id}/${Date.now()}-${spec.filename}`;

      // Upload to MinIO
      await s3.send(
        new PutObjectCommand({
          Bucket: s3Bucket,
          Key: storageKey,
          Body: buffer,
          ContentType: spec.contentType,
        })
      );
      uploadedS3Keys.push(storageKey);
      uploadedMinioCount++;

      // Extract text for FTS
      const extractedText = await extractText(spec.filename, spec.contentType, buffer);

      const attId = crypto.randomUUID();
      await client.query(
        `INSERT INTO ticket_attachments (
          id, ticket_id, org_id, team_id, uploader_id,
          filename, content_type, size_bytes, storage_key, extracted_text, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          attId,
          ticket.id,
          ticket.orgId,
          ticket.teamId,
          ticket.reporter.id,
          spec.filename,
          spec.contentType,
          buffer.length,
          storageKey,
          extractedText,
          ticket.createdAt,
        ]
      );
      seededAttachments.push(attId);
    }
  }

  // 9. External Links
  const linkTickets = seededTickets.slice(0, config.linkCount);
  const LINK_PROVIDERS = [
    {
      provider: "github",
      kind: "pr",
      urlPattern: (n) => `https://github.com/acme-example/platform/pull/${n}`,
      title: (n) => `feat(core): Optimize PostgreSQL query planning (#${n})`,
      ref: (n) => `acme-example/platform#${n}`,
      status: "merged",
    },
    {
      provider: "github",
      kind: "issue",
      urlPattern: (n) => `https://github.com/acme-example/platform/issues/${n}`,
      title: (n) => `bug(auth): Investigate session token expiry on mobile (#${n})`,
      ref: (n) => `acme-example/platform#${n}`,
      status: "closed",
    },
    {
      provider: "github",
      kind: "commit",
      urlPattern: (n) =>
        `https://github.com/acme-example/platform/commit/${crypto
          .createHash("sha1")
          .update(String(n))
          .digest("hex")}${crypto.createHash("md5").update(String(n)).digest("hex").slice(0, 8)}`,
      title: () => `refactor: Clean up unused dependencies and consolidate slugify`,
      ref: (n) => `acme-example/platform@${n}`,
      status: "committed",
    },
    {
      provider: "gitlab",
      kind: "mr",
      urlPattern: (n) => `https://gitlab.com/acme-example/core-api/-/merge_requests/${n}`,
      title: (n) => `Resolve optimistic column reordering race condition (!${n})`,
      ref: (n) => `acme-example/core-api!${n}`,
      status: "open",
    },
  ];

  for (let lIdx = 0; lIdx < linkTickets.length; lIdx++) {
    const ticket = linkTickets[lIdx];
    const lSpec = LINK_PROVIDERS[lIdx % LINK_PROVIDERS.length];
    const itemNum = lIdx + 101;
    const url = lSpec.urlPattern(itemNum);
    const title = lSpec.title(itemNum);
    const externalRef = lSpec.ref(itemNum);

    const linkId = crypto.randomUUID();
    await client.query(
      `INSERT INTO ticket_links (
        id, ticket_id, created_by_id, provider, kind, url, title, status, external_ref, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        linkId,
        ticket.id,
        ticket.reporter.id,
        lSpec.provider,
        lSpec.kind,
        url,
        title,
        lSpec.status,
        externalRef,
        ticket.createdAt,
      ]
    );
    seededLinks.push(linkId);
  }

  // 10. Setup State (if --setup-complete is true)
  const shouldCompleteSetup =
    flags["setup-complete"] && !flags["no-setup-complete"];

  if (shouldCompleteSetup) {
    await client.query(`
      INSERT INTO setup_state (
        id, admin_user_id, org_id, current_step, completed_steps, skipped_steps,
        is_completed, completed_at, updated_at
      ) VALUES (
        'default', $1, $2, 7, '[1,2,3,4,5,6,7]'::jsonb, '[]'::jsonb,
        true, now(), now()
      )
      ON CONFLICT (id) DO UPDATE SET
        admin_user_id = EXCLUDED.admin_user_id,
        org_id = EXCLUDED.org_id,
        current_step = 7,
        completed_steps = '[1,2,3,4,5,6,7]'::jsonb,
        skipped_steps = '[]'::jsonb,
        is_completed = true,
        completed_at = now(),
        updated_at = now()
    `, [adminUser.id, orgId]);

    // Setup Token: mark consumed and clear ciphertext
    await client.query(`
      INSERT INTO setup_token (id, ciphertext, iv, auth_tag, confirmed_at, consumed_at)
      VALUES ('default', NULL, NULL, NULL, now(), now())
      ON CONFLICT (id) DO UPDATE SET
        ciphertext = NULL,
        iv = NULL,
        auth_tag = NULL,
        confirmed_at = now(),
        consumed_at = now()
    `);

    // Purge setup credentials
    await client.query(`DELETE FROM setup_credentials`);
  }

  // Seed ticket watchers, mention comments, notifications (read & unread), and a disabled sample webhook
  if (seededTickets.length > 0 && usersList.length >= 2) {
    for (let i = 0; i < Math.min(seededTickets.length, 20); i++) {
      const t = seededTickets[i];
      const watcherA = usersList[i % usersList.length];
      const watcherB = usersList[(i + 1) % usersList.length];
      await client.query(
        `INSERT INTO ticket_watchers (ticket_id, user_id, source, muted)
         VALUES ($1, $2, 'creator', false), ($1, $3, 'assignee', false)
         ON CONFLICT (ticket_id, user_id) DO NOTHING`,
        [t.id, watcherA.id, watcherB.id]
      );
    }

    const firstTicket = seededTickets[0];
    const mentionTarget = usersList[0];
    const mentionActor = usersList[1];
    const [mentionComment] = (
      await client.query(
        `INSERT INTO ticket_comments (ticket_id, org_id, team_id, author_id, body)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          firstTicket.id,
          orgId,
          firstTicket.teamId,
          mentionActor.id,
          `Please review @[${mentionTarget.name}](mention:${mentionTarget.id}) before release.`,
        ]
      )
    ).rows;

    await client.query(
      `INSERT INTO notifications (recipient_id, type, ticket_id, comment_id, actor_id, summary, dedupe_key, group_key, read_at)
       VALUES
         ($1, 'mention', $2, $3, $4, $5::jsonb, $6, $7, NULL),
         ($1, 'assignment', $2, NULL, $4, $8::jsonb, $9, $10, NOW())
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        mentionTarget.id,
        firstTicket.id,
        mentionComment.id,
        mentionActor.id,
        JSON.stringify({
          ticketKey: firstTicket.key,
          eventKind: "comment.created",
          count: 1,
          snippet: `Please review @${mentionTarget.name} before release.`,
        }),
        `seed:mention:${firstTicket.id}:${mentionTarget.id}`,
        `mention:seed:${firstTicket.id}`,
        JSON.stringify({
          ticketKey: firstTicket.key,
          eventKind: "assigned",
          count: 1,
          snippet: null,
        }),
        `seed:assign:${firstTicket.id}:${mentionTarget.id}`,
        `assignment:seed:${firstTicket.id}`,
      ]
    );

    const rawKeyHex = (process.env.TOKEN_ENCRYPTION_KEY || "").trim();
    const keyBuf = /^[0-9a-fA-F]{64}$/.test(rawKeyHex)
      ? Buffer.from(rawKeyHex, "hex")
      : Buffer.alloc(32, 0);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf, iv, { authTagLength: 16 });
    const enc = Buffer.concat([cipher.update("whsec_seed_example_disabled", "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    await client.query(
      `INSERT INTO webhook_endpoints (
         org_id, name, url, format, events, secret_ciphertext, secret_iv, secret_auth_tag, enabled, created_by_id
       ) VALUES ($1, $2, $3, 'generic', $4, $5, $6, $7, false, $8)`,
      [
        orgId,
        "Sample Webhook (Disabled)",
        "https://example.com/patchwork-webhook",
        ["ticket.created", "comment.created", "mention"],
        enc.toString("base64"),
        iv.toString("base64"),
        tag.toString("base64"),
        adminUser.id,
      ]
    );
  }

  // COMMIT TRANSACTION
  await client.query("COMMIT");

  // Output summary table
  printSummaryTable({
    orgs: 1,
    teams: seededTeams.length,
    users: usersList.length,
    projects: seededProjects.length,
    boards: seededBoards.length,
    columns: seededBoards.length * 6,
    tickets: seededTickets.length,
    comments: seededComments.length,
    activities: seededActivities.length,
    attachments: seededAttachments.length,
    links: seededLinks.length,
    minioUploaded: uploadedMinioCount,
    dbName,
    dbHost,
    dbPort,
    seedNumber,
    adminEmail: adminUser.email,
    password: SHARED_DEV_PASSWORD,
  });

  client.release();
  await pool.end();
  process.exit(0);
} catch (err) {
  // ROLLBACK ON ERROR
  try {
    await client.query("ROLLBACK");
  } catch {}

  // Delete uploaded MinIO objects
  if (uploadedS3Keys && uploadedS3Keys.length > 0) {
    await deleteMinioObjects(uploadedS3Keys);
  }

  client.release();
  await pool.end();

  console.error("\n❌ Seeding failed. Transaction rolled back.", err);
  process.exit(1);
}

function printSummaryTable(stats) {
  const rows = [
    ["Organizations", stats.orgs],
    ["Teams", stats.teams],
    ["Users", stats.users],
    ["Projects", stats.projects],
    ["Boards", stats.boards],
    ["Columns", stats.columns],
    ["Tickets", stats.tickets],
    ["Comments", stats.comments],
    ["Activities", stats.activities],
    ["Attachments", stats.attachments],
    ["External Links", stats.links],
    ["MinIO Objects Uploaded", stats.minioUploaded],
  ];

  console.log("\n┌─────────────────────────┬──────────────┐");
  console.log("│ Entity / Table          │ Count        │");
  console.log("├─────────────────────────┼──────────────┤");
  for (const [entity, count] of rows) {
    const e = entity.padEnd(23);
    const c = String(count).padStart(12);
    console.log(`│ ${e} │ ${c} │`);
  }
  console.log("└─────────────────────────┴──────────────┘");
  console.log(`Organization    : ${stats.orgName || "Acme Corporation"}`);
  console.log(`Target Database : ${stats.dbName} (${stats.dbHost}:${stats.dbPort})`);
  console.log(`Seed Number     : ${stats.seedNumber}`);
  console.log(`Admin Email     : ${stats.adminEmail}`);
  console.log(`Dev Password    : ${stats.password}`);
  console.log(`Setup Complete  : yes (wizard bypassed, workspace ready)\n`);
}
