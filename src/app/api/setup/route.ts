import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/db";
import {
  SESSION_COOKIE_NAME,
  validateSessionToken,
  verifyCsrfToken,
} from "@/lib/auth";
import { handleApiError } from "@/lib/http";
import { getSetupSnapshotForUser, saveSetupDraft } from "@/lib/setup";

export async function GET(req: NextRequest) {
  try {
    await ensureMigrated();
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value || "";
    const auth = token ? await validateSessionToken(token) : null;
    const snapshot = await getSetupSnapshotForUser(auth?.user.id ?? null);
    return NextResponse.json({
      ...snapshot,
      user: auth?.user ?? null,
      csrfToken: auth?.session.csrfToken ?? "",
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    await ensureMigrated();
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value || "";
    const auth = token ? await validateSessionToken(token) : null;
    if (auth) {
      verifyCsrfToken(auth.session, req.headers.get("x-csrf-token"));
    }
    const body = await req.json();
    const updated = await saveSetupDraft(auth?.user.id ?? null, {
      currentStep:
        typeof body.currentStep === "number" ? body.currentStep : undefined,
      draftData: body.draftData || undefined,
    });
    return NextResponse.json({ state: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

