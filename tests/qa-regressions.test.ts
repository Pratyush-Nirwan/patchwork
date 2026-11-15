import { describe, it, expect, beforeAll } from "vitest";
import { db, ensureMigrated } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { registerUser, changeUserPassword, verifyCsrfToken } from "@/lib/auth";
import { validateAttachmentConstraints } from "@/lib/attachments";
import { handleApiError } from "@/lib/http";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { NextRequest } from "next/server";

describe("QA Regression Suite", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  it("requires currentPassword when mustChangePassword is false", async () => {
    const email = `qa-pw-${Date.now()}@example.com`;
    const auth = await registerUser({
      email,
      password: "InitialPassword123!",
      name: "QA Password User",
    });
    await db
      .update(users)
      .set({ mustChangePassword: false })
      .where(eq(users.id, auth.user.id));

    await expect(
      changeUserPassword(auth.user.id, {
        newPassword: "NewPassword456!",
      })
    ).rejects.toThrow(/current password/i);
  });

  it("rate limits repeated failed login attempts with HTTP 429", async () => {
    const email = `qa-ratelimit-${Date.now()}@example.com`;
    await registerUser({
      email,
      password: "CorrectPassword123!",
      name: "QA Rate Limit User",
    });

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const req = new NextRequest("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "198.51.100.77",
        },
        body: JSON.stringify({
          email,
          password: "WrongPassword999!",
        }),
      });
      const res = await loginPost(req);
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it("rejects spoofed image uploads whose file content does not match magic bytes", async () => {
    await expect(
      validateAttachmentConstraints({
        filename: "evil.png",
        contentType: "image/png",
        sizeBytes: 25,
        buffer: Buffer.from("<script>alert(1)</script>"),
      })
    ).rejects.toThrow(/content|signature|magic/i);
  });

  it("redacts internal error details on unhandled 500 errors", async () => {
    const res = handleApiError(
      new Error("relation \"secret_internal_table\" does not exist at postgres://u:pass@host/db")
    );
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).not.toContain("secret_internal_table");
    expect(body.error).not.toContain("postgres://");
  });

  it("verifies CSRF tokens in constant time", () => {
    expect(() =>
      verifyCsrfToken({ csrfToken: "abc123" }, "abc123")
    ).not.toThrow();
    expect(() =>
      verifyCsrfToken({ csrfToken: "abc123" }, "abc124")
    ).toThrow();
    expect(() =>
      verifyCsrfToken({ csrfToken: "abc123" }, "short")
    ).toThrow();
  });
});

