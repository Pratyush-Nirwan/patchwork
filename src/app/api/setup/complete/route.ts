import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/db";
import {
  SESSION_COOKIE_NAME,
  validateSessionToken,
  verifyCsrfToken,
} from "@/lib/auth";
import { handleApiError } from "@/lib/http";
import { completeSetupWizard, SETUP_NOTICE } from "@/lib/setup";
import { ForbiddenError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    await ensureMigrated();
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value || "";
    const auth = token ? await validateSessionToken(token) : null;
    if (!auth) {
      throw new ForbiddenError("Authentication required to complete setup");
    }
    verifyCsrfToken(auth.session, req.headers.get("x-csrf-token"));

    const { state, summary } = await completeSetupWizard(auth.user.id);
    return NextResponse.json({
      notice: SETUP_NOTICE,
      isCompleted: state.isCompleted,
      completedSteps: state.completedSteps,
      skippedSteps: state.skippedSteps,
      summary,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

