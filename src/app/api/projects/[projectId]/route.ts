import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { updateProject, deleteProject } from "@/lib/hierarchy";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { projectId } = await context.params;
    const body = await req.json();
    const project = await updateProject(auth.user.id, projectId, {
      name: body.name !== undefined ? String(body.name) : undefined,
      description: body.description !== undefined ? String(body.description) : undefined,
    });
    return NextResponse.json({ project });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { projectId } = await context.params;
    await deleteProject(auth.user.id, projectId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

