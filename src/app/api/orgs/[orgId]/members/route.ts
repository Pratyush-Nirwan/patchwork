import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { addOrgMember, listOrgMembers } from "@/lib/hierarchy";
import type { OrgRole } from "@/db/schema";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ orgId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req, { skipCsrf: true });
    const { orgId } = await context.params;
    const members = await listOrgMembers(auth.user.id, orgId);
    return NextResponse.json({ members });
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
    const member = await addOrgMember(auth.user.id, orgId, {
      email: body.email ? String(body.email) : undefined,
      userId: body.userId ? String(body.userId) : undefined,
      name: body.name ? String(body.name) : undefined,
      password: body.password ? String(body.password) : undefined,
      role: (body.role || "member") as OrgRole,
    });
    return NextResponse.json({ member }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

