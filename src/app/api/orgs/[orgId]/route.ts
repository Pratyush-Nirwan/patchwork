import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { updateOrg, deleteOrg } from "@/lib/hierarchy";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ orgId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { orgId } = await context.params;
    const body = await req.json();
    const org = await updateOrg(auth.user.id, orgId, {
      name: String(body.name || ""),
    });
    return NextResponse.json({ org });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ orgId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { orgId } = await context.params;
    await deleteOrg(auth.user.id, orgId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

