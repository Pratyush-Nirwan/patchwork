import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { searchWorkspaceScoped } from "@/lib/search";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req, { skipCsrf: true });
    const q = req.nextUrl.searchParams.get("q") || "";
    const orgId = req.nextUrl.searchParams.get("orgId") || undefined;
    const { results, groups } = await searchWorkspaceScoped(auth.user.id, q, {
      orgId,
      limit: 25,
    });
    return NextResponse.json({ results, groups });
  } catch (err) {
    return handleApiError(err);
  }
}
