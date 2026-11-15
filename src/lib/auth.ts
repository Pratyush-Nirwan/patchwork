import argon2 from "argon2";
import crypto from "crypto";
import { eq, and, gt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, sessions, setupState, setupCredentials } from "@/db/schema";
import { AppError, UnauthorizedError, ForbiddenError } from "./errors";
import { normalizeEmail, isValidEmailFormat, EmailTakenError } from "./email";
import { getSystemSetting, getDefaultSetting } from "./settings";

export const SESSION_COOKIE_NAME = "patchwork_session";
export const CSRF_COOKIE_NAME = "patchwork_csrf";
export const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export interface AuthContext {
  user: {
    id: string;
    email: string;
    name: string;
    mustChangePassword: boolean;
    isSetupAdmin: boolean;
    createdAt: Date;
  };
  session: {
    id: string;
    csrfToken: string;
    expiresAt: Date;
  };
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export async function validatePasswordAgainstPolicy(password: string): Promise<void> {
  const security = await getSystemSetting("security").catch(() => getDefaultSetting("security"));
  if (!password || password.length < security.passwordMinLength) {
    throw new AppError(
      `Password must be at least ${security.passwordMinLength} characters`,
      400,
      "WEAK_PASSWORD"
    );
  }
  if (security.passwordRequireMixedCase && (!/[a-z]/.test(password) || !/[A-Z]/.test(password))) {
    throw new AppError(
      "Password must contain both uppercase and lowercase letters",
      400,
      "WEAK_PASSWORD"
    );
  }
  if (security.passwordRequireDigit && !/[0-9]/.test(password)) {
    throw new AppError("Password must contain at least one digit", 400, "WEAK_PASSWORD");
  }
  if (security.passwordRequireSymbol && !/[^a-zA-Z0-9]/.test(password)) {
    throw new AppError("Password must contain at least one symbol", 400, "WEAK_PASSWORD");
  }
}

export async function registerUser(input: {
  email: string;
  password: string;
  name: string;
  ttlMs?: number;
  mustChangePassword?: boolean;
  isPublicRegistration?: boolean;
}): Promise<AuthContext> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  if (!email || !isValidEmailFormat(email)) {
    throw new AppError("Valid email is required", 400, "INVALID_EMAIL");
  }
  if (!name) {
    throw new AppError("Name is required", 400, "INVALID_NAME");
  }
  await validatePasswordAgainstPolicy(input.password);

  const existingUsers = await db.select({ id: users.id }).from(users).limit(1);
  const isFirstUser = existingUsers.length === 0;

  const [state] = await db
    .select()
    .from(setupState)
    .where(eq(setupState.id, "default"))
    .limit(1);

  if (input.isPublicRegistration && state?.isCompleted) {
    throw new ForbiddenError(
      "Public registration is closed. Contact your administrator for an account."
    );
  }

  if (!isFirstUser && (!state || !state.isCompleted)) {
    throw new ForbiddenError(
      "Registration is closed until initial workspace setup is completed"
    );
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  if (existing) {
    throw new EmailTakenError(`This email is already used by ${existing.name}.`, existing.name);
  }

  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(users)
    .values({
      email,
      name,
      passwordHash,
      mustChangePassword: isFirstUser ? false : Boolean(input.mustChangePassword),
      isSetupAdmin: isFirstUser,
    })
    .returning();

  if (isFirstUser) {
    const nextCompleted = Array.from(
      new Set([...(state?.completedSteps || []), 1])
    );
    const nextDraft = {
      ...(state?.draftData || {}),
      admin: { name: user.name, email: user.email },
    };
    const nextStep = Math.max(state?.currentStep || 1, 2);
    if (!state) {
      await db.insert(setupState).values({
        id: "default",
        adminUserId: user.id,
        currentStep: nextStep,
        completedSteps: nextCompleted,
        skippedSteps: [],
        draftData: nextDraft,
        isCompleted: false,
      });
    } else {
      await db
        .update(setupState)
        .set({
          adminUserId: user.id,
          currentStep: nextStep,
          completedSteps: nextCompleted,
          draftData: nextDraft,
          updatedAt: new Date(),
        })
        .where(eq(setupState.id, "default"));
    }
  }

  const session = await createSession(user.id, input.ttlMs);
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      mustChangePassword: user.mustChangePassword,
      isSetupAdmin: user.isSetupAdmin,
      createdAt: user.createdAt,
    },
    session,
  };
}

export async function loginUser(input: {
  email: string;
  password: string;
  ttlMs?: number;
}): Promise<AuthContext> {
  const email = normalizeEmail(input.email);
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  if (!user) {
    throw new UnauthorizedError("Invalid email or password");
  }

  if (user.isDeactivated) {
    throw new UnauthorizedError("Account is deactivated. Contact your administrator.");
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    throw new UnauthorizedError("Invalid email or password");
  }

  await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, user.id));

  const session = await createSession(user.id, input.ttlMs);
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      mustChangePassword: user.mustChangePassword,
      isSetupAdmin: user.isSetupAdmin,
      createdAt: user.createdAt,
    },
    session,
  };
}

export async function changeUserPassword(
  userId: string,
  input: { currentPassword?: string; newPassword: string }
) {
  await validatePasswordAgainstPolicy(input.newPassword);
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    throw new UnauthorizedError("User not found");
  }
  if (user.mustChangePassword === false && input.currentPassword === undefined) {
    throw new UnauthorizedError("Current password is required");
  }
  if (input.currentPassword !== undefined) {
    const valid = await verifyPassword(user.passwordHash, input.currentPassword);
    if (!valid) {
      throw new UnauthorizedError("Current password is incorrect");
    }
    if (input.currentPassword === input.newPassword) {
      throw new AppError(
        "New password must be different from your temporary password",
        400,
        "SAME_PASSWORD"
      );
    }
  }
  const passwordHash = await hashPassword(input.newPassword);
  const [updated] = await db
    .update(users)
    .set({
      passwordHash,
      mustChangePassword: false,
    })
    .where(eq(users.id, userId))
    .returning();

  await db.delete(setupCredentials).where(eq(setupCredentials.userId, userId));

  return {
    id: updated.id,
    email: updated.email,
    name: updated.name,
    mustChangePassword: updated.mustChangePassword,
    isSetupAdmin: updated.isSetupAdmin,
    createdAt: updated.createdAt,
  };
}

export async function createSession(
  userId: string,
  ttlMs?: number
): Promise<{ id: string; csrfToken: string; expiresAt: Date }> {
  let effectiveTtl = ttlMs;
  if (!effectiveTtl) {
    try {
      const sec = await getSystemSetting("security");
      effectiveTtl = sec.sessionLifetimeMs;
    } catch {
      effectiveTtl = SESSION_DURATION_MS;
    }
  }
  const id = crypto.randomBytes(32).toString("hex");
  const csrfToken = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + effectiveTtl);

  const now = new Date();
  await db.insert(sessions).values({
    id,
    userId,
    csrfToken,
    expiresAt,
    lastActiveAt: now,
  });

  return { id, csrfToken, expiresAt };
}

export const SESSION_IDLE_TOUCH_INTERVAL_MS = 60_000;

export async function validateSessionTokenDetailed(
  sessionId: string,
  options?: { skipTouch?: boolean }
): Promise<{ auth: AuthContext | null; reason?: "idle_expired" | "invalid" }> {
  if (!sessionId) return { auth: null, reason: "invalid" };
  const now = new Date();
  const rows = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
    .limit(1);

  if (rows.length === 0) {
    return { auth: null, reason: "invalid" };
  }

  const { session, user } = rows[0];
  if (user.isDeactivated) {
    return { auth: null, reason: "invalid" };
  }

  let idleTimeoutMs = 0;
  try {
    const sec = await getSystemSetting("security");
    idleTimeoutMs = sec.sessionIdleTimeoutMs;
  } catch {
    idleTimeoutMs = 0;
  }

  const lastActiveMs = session.lastActiveAt
    ? session.lastActiveAt.getTime()
    : session.createdAt.getTime();

  if (idleTimeoutMs > 0 && now.getTime() - lastActiveMs > idleTimeoutMs) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return { auth: null, reason: "idle_expired" };
  }

  if (!options?.skipTouch && now.getTime() - lastActiveMs >= SESSION_IDLE_TOUCH_INTERVAL_MS) {
    const throttleCutoff = new Date(now.getTime() - SESSION_IDLE_TOUCH_INTERVAL_MS);
    await db
      .update(sessions)
      .set({ lastActiveAt: now })
      .where(and(eq(sessions.id, sessionId), lte(sessions.lastActiveAt, throttleCutoff)));
  }

  return {
    auth: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        mustChangePassword: user.mustChangePassword,
        isSetupAdmin: user.isSetupAdmin,
        createdAt: user.createdAt,
      },
      session: {
        id: session.id,
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
      },
    },
  };
}

export async function validateSessionToken(
  sessionId: string,
  options?: { skipTouch?: boolean }
): Promise<AuthContext | null> {
  const res = await validateSessionTokenDetailed(sessionId, options);
  return res.auth;
}

export async function invalidateSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export function verifyCsrfToken(session: { csrfToken: string }, providedToken?: string | null): void {
  if (!providedToken) {
    throw new ForbiddenError("Invalid or missing CSRF token");
  }
  const a = Buffer.from(session.csrfToken, "utf8");
  const b = Buffer.from(providedToken, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new ForbiddenError("Invalid or missing CSRF token");
  }
}

const loginFailures = new Map<string, number[]>();

export async function enforceLoginRateLimit(key: string): Promise<{ maxFailures: number; windowMs: number }> {
  let maxFailures = 5;
  let windowMs = 15 * 60 * 1000;
  try {
    const sec = await getSystemSetting("security");
    maxFailures = sec.rateLimitMaxFailures;
    windowMs = sec.rateLimitWindowMs;
  } catch {
    // fallback to defaults
  }

  const now = Date.now();
  const attempts = (loginFailures.get(key) || []).filter((ts) => now - ts < windowMs);
  if (attempts.length === 0) {
    loginFailures.delete(key);
  } else {
    loginFailures.set(key, attempts);
  }

  if (attempts.length >= maxFailures) {
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - attempts[0])) / 1000));
    throw new AppError(
      `Too many failed login attempts. Try again in ${retryAfterSec} seconds.`,
      429,
      "RATE_LIMITED"
    );
  }

  return { maxFailures, windowMs };
}

export function recordLoginFailure(key: string, windowMs: number): void {
  const now = Date.now();
  const attempts = (loginFailures.get(key) || []).filter((ts) => now - ts < windowMs);
  attempts.push(now);
  loginFailures.set(key, attempts);
}

export function clearLoginFailures(key: string): void {
  loginFailures.delete(key);
}

