import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/db";
import {
  SESSION_COOKIE_NAME,
  validateSessionToken,
  verifyCsrfToken,
} from "@/lib/auth";
import { attachAuthCookies, handleApiError } from "@/lib/http";
import {
  runSetupStep1Admin,
  runSetupStep2Org,
  runSetupStep3Teams,
  runSetupStep4Employees,
  runSetupStep5Projects,
  runSetupStep6Boards,
  skipSetupStep,
  getSetupSnapshotForUser,
  ValidationError,
} from "@/lib/setup";
import { ForbiddenError } from "@/lib/errors";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ step: string }> }
) {
  try {
    await ensureMigrated();
    const { step: stepParam } = await context.params;
    const stepNum = Number(stepParam);
    if (!Number.isInteger(stepNum) || stepNum < 1 || stepNum > 6) {
      throw new ValidationError("Step must be between 1 and 6", {
        step: "Invalid step number",
      });
    }

    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value || "";
    const auth = token ? await validateSessionToken(token) : null;
    const body = await req.json();

    if (stepNum === 1) {
      if (auth) {
        verifyCsrfToken(auth.session, req.headers.get("x-csrf-token"));
      }
      const forwardedFor = req.headers.get("x-forwarded-for");
      const clientIp = forwardedFor
        ? forwardedFor.split(",")[0].trim()
        : req.headers.get("x-real-ip") || "127.0.0.1";

      const resData = await runSetupStep1Admin(auth?.user.id ?? null, {
        name: String(body.name || ""),
        email: String(body.email || ""),
        password: body.password !== undefined ? String(body.password) : undefined,
        setupToken: body.setupToken !== undefined ? String(body.setupToken) : undefined,
        clientIp,
      });

      const activeAuth = resData.auth || auth;
      const snapshot = await getSetupSnapshotForUser(
        activeAuth?.user.id ?? resData.state.adminUserId
      );
      const res = NextResponse.json(
        {
          ...snapshot,
          user: activeAuth?.user ?? null,
          csrfToken: activeAuth?.session.csrfToken ?? "",
        },
        { status: resData.auth ? 201 : 200 }
      );
      if (resData.auth) {
        return attachAuthCookies(res, resData.auth);
      }
      return res;
    }

    if (!auth) {
      throw new ForbiddenError("Authentication required to continue setup");
    }
    verifyCsrfToken(auth.session, req.headers.get("x-csrf-token"));

    if (body.skip === true) {
      await skipSetupStep(auth.user.id, stepNum);
      const snapshot = await getSetupSnapshotForUser(auth.user.id);
      return NextResponse.json({
        ...snapshot,
        user: auth.user,
        csrfToken: auth.session.csrfToken,
      });
    }

    let provisionedCredentials: unknown = undefined;

    if (stepNum === 2) {
      await runSetupStep2Org(auth.user.id, {
        name: String(body.name || ""),
        slug: body.slug ? String(body.slug) : undefined,
        description: body.description ? String(body.description) : undefined,
      });
    } else if (stepNum === 3) {
      await runSetupStep3Teams(auth.user.id, {
        teams: Array.isArray(body.teams) ? body.teams : [],
      });
    } else if (stepNum === 4) {
      const r4 = await runSetupStep4Employees(auth.user.id, {
        employees: Array.isArray(body.employees) ? body.employees : [],
      });
      provisionedCredentials = r4.employees;
    } else if (stepNum === 5) {
      await runSetupStep5Projects(auth.user.id, {
        projects: Array.isArray(body.projects) ? body.projects : [],
      });
    } else if (stepNum === 6) {
      await runSetupStep6Boards(auth.user.id, {
        boards: Array.isArray(body.boards) ? body.boards : [],
      });
    }

    const snapshot = await getSetupSnapshotForUser(auth.user.id);
    return NextResponse.json({
      ...snapshot,
      provisionedCredentials,
      user: auth.user,
      csrfToken: auth.session.csrfToken,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

