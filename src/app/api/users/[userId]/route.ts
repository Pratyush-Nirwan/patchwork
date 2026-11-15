import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { updateUser } from "@/lib/hierarchy";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { userId } = await context.params;
    const body = await req.json();

    const updated = await updateUser(auth.user.id, userId, {
      name: body.name !== undefined ? String(body.name) : undefined,
      email: body.email !== undefined ? String(body.email) : undefined,
    });

    return NextResponse.json({ user: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

