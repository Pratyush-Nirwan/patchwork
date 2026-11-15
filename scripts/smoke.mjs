import { spawn } from "child_process";
import path from "path";
import dotenv from "dotenv";
import pg from "pg";
import argon2 from "argon2";

dotenv.config();
dotenv.config({ path: ".env.test" });

const DB_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork_test";

const BASE_URL = process.env.APP_URL || "http://localhost:3000";

class SessionClient {
  constructor() {
    this.cookies = new Map();
    this.csrfToken = "";
  }

  updateCookies(res) {
    const setCookies =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie")]
        : [];

    for (const raw of setCookies) {
      if (!raw) continue;
      const firstPart = raw.split(";")[0];
      const eqIdx = firstPart.indexOf("=");
      if (eqIdx > 0) {
        const name = firstPart.slice(0, eqIdx).trim();
        const val = firstPart.slice(eqIdx + 1).trim();
        this.cookies.set(name, val);
      }
    }
  }

  cookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  async request(endpoint, options = {}) {
    const headers = new Headers(options.headers || {});
    const cookieStr = this.cookieHeader();
    if (cookieStr) headers.set("Cookie", cookieStr);
    if (this.csrfToken && options.method && options.method !== "GET") {
      headers.set("x-csrf-token", this.csrfToken);
    }
    if (
      options.body &&
      typeof options.body === "string" &&
      !headers.has("Content-Type")
    ) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });
    this.updateCookies(res);
    return res;
  }
}

async function isServerHealthy() {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function startTempServerIfNeeded() {
  if (await isServerHealthy()) {
    return null;
  }
  console.log("Starting native Next.js production server for smoke test...");
  const nextBin = path.join(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "bin",
    "next"
  );
  const child = spawn(process.execPath, [nextBin, "start", "-p", "3000"], {
    env: {
      ...process.env,
      DATABASE_URL: DB_URL,
      NODE_ENV: "production",
    },
    stdio: "ignore",
    windowsHide: true,
  });

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isServerHealthy()) {
      return child;
    }
  }
  child.kill();
  throw new Error("Server failed to start on http://localhost:3000");
}

async function runSmoke() {
  const serverProc = await startTempServerIfNeeded();
  try {
    // 1. /api/health returns 200
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    if (healthRes.status !== 200) {
      throw new Error(`/api/health returned ${healthRes.status}`);
    }
    console.log("[1/5] /api/health returned 200 OK");

    // 2. Verify public registration is closed (Change 1), then provision admin user directly and log in
    const clientA = new SessionClient();
    const suffix = Date.now();
    const email = `smoke-${suffix}@patchwork.dev`;
    const password = "SmokeTestPassword123!";

    const regRes = await clientA.request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        name: "Smoke Admin",
      }),
    });
    if (regRes.status !== 403) {
      throw new Error(`Expected registration to return 403 when closed, got ${regRes.status}`);
    }

    const pool = new pg.Pool({
      connectionString: DB_URL,
    });
    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    await pool.query(
      "INSERT INTO users (id, email, name, password_hash, is_setup_admin) VALUES (gen_random_uuid(), $1, $2, $3, true) ON CONFLICT (lower(email)) DO UPDATE SET password_hash = $3 RETURNING id, email",
      [email.toLowerCase(), "Smoke Admin", hash]
    );
    await pool.end();

    const loginResA = await clientA.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
      }),
    });
    if (loginResA.status !== 200) {
      const errBody = await loginResA.text();
      throw new Error(`Login failed with ${loginResA.status}: ${errBody}`);
    }
    const loginDataA = await loginResA.json();
    clientA.csrfToken = loginDataA.csrfToken;

    const orgRes = await clientA.request("/api/orgs", {
      method: "POST",
      body: JSON.stringify({ name: `Smoke Org ${suffix}` }),
    });
    if (orgRes.status !== 201) throw new Error("Create org failed");
    const { org } = await orgRes.json();

    const teamRes = await clientA.request(`/api/orgs/${org.id}/teams`, {
      method: "POST",
      body: JSON.stringify({ name: "Smoke Team" }),
    });
    if (teamRes.status !== 201) throw new Error("Create team failed");
    const { team } = await teamRes.json();

    const projRes = await clientA.request(`/api/teams/${team.id}/projects`, {
      method: "POST",
      body: JSON.stringify({ name: "Smoke Project", key: "SMKE" }),
    });
    if (projRes.status !== 201) throw new Error("Create project failed");
    const { project } = await projRes.json();

    const boardRes = await clientA.request(`/api/projects/${project.id}/boards`, {
      method: "POST",
      body: JSON.stringify({ name: "Smoke Board" }),
    });
    if (boardRes.status !== 201) throw new Error("Create board failed");
    const { board } = await boardRes.json();
    console.log("[2/5] Registered admin and created Org -> Team -> Project -> Board");

    // 3. Create a ticket, move it, add a comment
    const ticketRes = await clientA.request(`/api/boards/${board.id}/tickets`, {
      method: "POST",
      body: JSON.stringify({
        title: "Verify end-to-end smoke pipeline",
        description: "Initial smoke test ticket",
        priority: "high",
      }),
    });
    if (ticketRes.status !== 201) throw new Error("Create ticket failed");
    const { ticket } = await ticketRes.json();

    const targetCol = board.columns[1];
    const moveRes = await clientA.request(`/api/tickets/${ticket.id}/move`, {
      method: "POST",
      body: JSON.stringify({ targetColumnId: targetCol.id }),
    });
    if (moveRes.status !== 200) throw new Error("Move ticket failed");

    const commentRes = await clientA.request(`/api/tickets/${ticket.id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: "Smoke comment recorded." }),
    });
    if (commentRes.status !== 201) throw new Error("Add comment failed");
    console.log("[3/5] Created ticket, moved across columns, and added comment");

    // 4. Upload a text file and search for a word inside it
    const uniqueWord = `AstralSmokeVector${suffix}`;
    const attachRes = await clientA.request(
      `/api/tickets/${ticket.id}/attachments`,
      {
        method: "POST",
        body: JSON.stringify({
          filename: "smoke-notes.txt",
          contentType: "text/plain",
          content: `Confidential operational note with keyword ${uniqueWord} inside.`,
        }),
      }
    );
    if (attachRes.status !== 201) {
      const errText = await attachRes.text();
      throw new Error(`Upload attachment failed (${attachRes.status}): ${errText}`);
    }

    const searchRes = await clientA.request(
      `/api/search?q=${encodeURIComponent(uniqueWord)}`
    );
    if (searchRes.status !== 200) throw new Error("Search request failed");
    const { results } = await searchRes.json();
    if (!results.some((r) => r.ticketId === ticket.id && r.kind === "attachment")) {
      throw new Error("Uploaded attachment text was not found by full-text search");
    }
    console.log("[4/5] Uploaded text file to MinIO and found keyword via FTS");

    // 5. Open an SSE connection, move a ticket from a second session, verify the event arrives
    const abortController = new AbortController();
    const sseRes = await fetch(`${BASE_URL}/api/events?boardId=${board.id}`, {
      headers: {
        Cookie: clientA.cookieHeader(),
      },
      signal: abortController.signal,
    });
    if (sseRes.status !== 200 || !sseRes.body) {
      throw new Error(`SSE connection failed with ${sseRes.status}`);
    }

    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const waitForMovedEvent = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          if (chunk.includes("event: message")) {
            const dataLine = chunk
              .split("\n")
              .find((l) => l.startsWith("data: "));
            if (dataLine) {
              const parsed = JSON.parse(dataLine.slice(6));
              if (
                parsed.type === "ticket.moved" &&
                parsed.ticketId === ticket.id
              ) {
                return parsed;
              }
            }
          }
        }
      }
      throw new Error("SSE stream ended before ticket.moved event arrived");
    })();

    // Give SSE subscription a moment to register LISTEN
    await new Promise((r) => setTimeout(r, 200));

    // Second session logs in and moves the ticket
    const clientB = new SessionClient();
    const loginRes = await clientB.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (loginRes.status !== 200) throw new Error("Second session login failed");
    const loginData = await loginRes.json();
    clientB.csrfToken = loginData.csrfToken;

    const thirdCol = board.columns[2];
    const moveResB = await clientB.request(`/api/tickets/${ticket.id}/move`, {
      method: "POST",
      body: JSON.stringify({ targetColumnId: thirdCol.id }),
    });
    if (moveResB.status !== 200) {
      throw new Error("Second session ticket move failed");
    }

    const receivedEvent = await Promise.race([
      waitForMovedEvent,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Timed out waiting for SSE ticket.moved event")),
          8000
        )
      ),
    ]);

    abortController.abort();
    if (receivedEvent.payload.toColumnId !== thirdCol.id) {
      throw new Error("SSE event target column mismatch");
    }
    console.log(
      "[5/5] Verified real-time SSE ticket.moved event from second session"
    );
    console.log("Smoke test passed 100%.");
  } finally {
    if (serverProc) {
      serverProc.kill();
    }
  }
}

runSmoke().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});

