import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { createProject, listTeamProjects } from "@/lib/hierarchy";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ teamId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req, { skipCsrf: true });
    const { teamId } = await context.params;
    const projects = await listTeamProjects(auth.user.id, teamId);
    return NextResponse.json({ projects });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ teamId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { teamId } = await context.params;
    const body = await req.json();
    const project = await createProject(auth.user.id, teamId, {
      name: String(body.name || ""),
      key: body.key ? String(body.key) : undefined,
      description: body.description ? String(body.description) : undefined,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

