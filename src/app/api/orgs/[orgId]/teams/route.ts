import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { createTeam, listOrgTeams } from "@/lib/hierarchy";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ orgId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req, { skipCsrf: true });
    const { orgId } = await context.params;
    const teams = await listOrgTeams(auth.user.id, orgId);
    return NextResponse.json({ teams });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ orgId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { orgId } = await context.params;
    const body = await req.json();
    const team = await createTeam(auth.user.id, orgId, {
      name: String(body.name || ""),
      slug: body.slug ? String(body.slug) : undefined,
      description: body.description ? String(body.description) : undefined,
    });
    return NextResponse.json({ team }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

