import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { getFullWorkspaceTree } from "@/lib/hierarchy";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req, {
      skipCsrf: true,
      allowMustChangePassword: true,
    });
    if (auth.user.mustChangePassword) {
      return NextResponse.json({
        user: auth.user,
        csrfToken: auth.session.csrfToken,
        orgs: [],
      });
    }
    const tree = await getFullWorkspaceTree(auth.user.id);
    return NextResponse.json({
      user: auth.user,
      csrfToken: auth.session.csrfToken,
      orgs: tree,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

