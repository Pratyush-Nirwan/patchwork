import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  validateSessionTokenDetailed,
  verifyCsrfToken,
  type AuthContext,
} from "./auth";
import { AppError, UnauthorizedError } from "./errors";
import { EmailTakenError } from "./email";
import { ensureMigrated } from "@/db";
import { recordServerError } from "./diagnostics";

export async function requireRequestAuth(
  req: NextRequest,
  options?: { skipCsrf?: boolean; allowMustChangePassword?: boolean; skipTouch?: boolean }
): Promise<AuthContext> {
  await ensureMigrated();
  const cookieToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const bearerHeader = req.headers.get("authorization");
  const bearerToken = bearerHeader?.startsWith("Bearer ")
    ? bearerHeader.slice(7).trim()
    : undefined;

  const token = cookieToken || bearerToken;
  if (!token) {
    throw new UnauthorizedError("Not authenticated");
  }

  const { auth, reason } = await validateSessionTokenDetailed(token, {
    skipTouch: options?.skipTouch,
  });
  if (!auth) {
    if (reason === "idle_expired") {
      throw new AppError(
        "Your session expired due to inactivity",
        401,
        "SESSION_IDLE_EXPIRED"
      );
    }
    throw new UnauthorizedError("Session expired or invalid");
  }

  const method = req.method.toUpperCase();
  if (!options?.skipCsrf && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrfHeader = req.headers.get("x-csrf-token");
    verifyCsrfToken(auth.session, csrfHeader);
  }

  if (auth.user.mustChangePassword && !options?.allowMustChangePassword) {
    throw new AppError(
      "You must change your temporary password on first login before continuing",
      403,
      "PASSWORD_CHANGE_REQUIRED"
    );
  }

  return auth;
}

export function attachAuthCookies(res: NextResponse, auth: AuthContext): NextResponse {
  const isProd = process.env.NODE_ENV === "production" && process.env.APP_URL?.startsWith("https:");
  res.cookies.set(SESSION_COOKIE_NAME, auth.session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: Boolean(isProd),
    path: "/",
    expires: auth.session.expiresAt,
  });
  res.cookies.set(CSRF_COOKIE_NAME, auth.session.csrfToken, {
    httpOnly: false,
    sameSite: "lax",
    secure: Boolean(isProd),
    path: "/",
    expires: auth.session.expiresAt,
  });
  return res;
}

export function clearAuthCookies(res: NextResponse): NextResponse {
  res.cookies.delete(SESSION_COOKIE_NAME);
  res.cookies.delete(CSRF_COOKIE_NAME);
  return res;
}

interface ErrorWithCode {
  code?: string;
  originalError?: { code?: string };
  cause?: { code?: string };
  usedBy?: string;
}

export function handleApiError(err: unknown): NextResponse {
  const errWithCode = (typeof err === "object" && err !== null ? err : {}) as ErrorWithCode;
  const pgCode =
    errWithCode.code ||
    errWithCode.originalError?.code ||
    errWithCode.cause?.code;

  if (pgCode === "23505") {
    return NextResponse.json(
      {
        error: "email_taken",
        field: "email",
        message: "This email is already used by another user.",
      },
      { status: 409 }
    );
  }

  if (err instanceof EmailTakenError || errWithCode.code === "email_taken") {
    return NextResponse.json(
      {
        error: "email_taken",
        field: "email",
        message: (err as Error).message || "This email is already used by another user.",
        ...(errWithCode.usedBy ? { usedBy: errWithCode.usedBy } : {}),
      },
      { status: 409 }
    );
  }

  if (err instanceof AppError) {
    const extra: Record<string, unknown> = {};
    if ("fields" in err && err.fields) {
      extra.fields = err.fields;
    }
    if ("rowErrors" in err && err.rowErrors) {
      extra.rowErrors = err.rowErrors;
    }
    return NextResponse.json(
      { error: err.message, code: err.code, ...extra },
      { status: err.status }
    );
  }
  console.error("Unhandled API Error:", err);
  recordServerError(err);
  return NextResponse.json(
    { error: "An unexpected internal error occurred.", code: "INTERNAL_ERROR" },
    { status: 500 }
  );
}

