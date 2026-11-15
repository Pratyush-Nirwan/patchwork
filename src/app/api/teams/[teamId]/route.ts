import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { updateTeam, deleteTeam } from "@/lib/hierarchy";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ teamId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { teamId } = await context.params;
    const body = await req.json();
    const team = await updateTeam(auth.user.id, teamId, {
      name: body.name !== undefined ? String(body.name) : undefined,
      description: body.description !== undefined ? String(body.description) : undefined,
    });
    return NextResponse.json({ team });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ teamId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { teamId } = await context.params;
    await deleteTeam(auth.user.id, teamId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

