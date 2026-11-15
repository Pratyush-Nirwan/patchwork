import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { addTeamMember, listTeamMembers } from "@/lib/hierarchy";
import type { TeamRole } from "@/db/schema";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ teamId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req, { skipCsrf: true });
    const { teamId } = await context.params;
    const members = await listTeamMembers(auth.user.id, teamId);
    return NextResponse.json({ members });
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
    const member = await addTeamMember(auth.user.id, teamId, {
      userId: body.userId ? String(body.userId) : undefined,
      email: body.email ? String(body.email) : undefined,
      name: body.name ? String(body.name) : undefined,
      password: body.password ? String(body.password) : undefined,
      role: (body.role || "member") as TeamRole | "admin",
    });
    return NextResponse.json({ member }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

