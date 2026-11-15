import { NextRequest, NextResponse } from "next/server";
import {
  loginUser,
  enforceLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
} from "@/lib/auth";
import { attachAuthCookies, handleApiError } from "@/lib/http";
import { ensureMigrated } from "@/db";

export async function POST(req: NextRequest) {
  try {
    await ensureMigrated();
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "local";
    const rateKey = `${ip}:${email}`;
    const { windowMs } = await enforceLoginRateLimit(rateKey);

    try {
      const auth = await loginUser({
        email,
        password: String(body.password || ""),
      });
      clearLoginFailures(rateKey);

      const res = NextResponse.json({
        user: auth.user,
        csrfToken: auth.session.csrfToken,
        expiresAt: auth.session.expiresAt,
      });
      return attachAuthCookies(res, auth);
    } catch (err) {
      recordLoginFailure(rateKey, windowMs);
      throw err;
    }
  } catch (err) {
    return handleApiError(err);
  }
}

