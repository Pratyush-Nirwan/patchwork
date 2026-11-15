import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { updateColumn, deleteColumn } from "@/lib/hierarchy";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ columnId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { columnId } = await context.params;
    const body = await req.json();
    const column = await updateColumn(auth.user.id, columnId, {
      name: body.name !== undefined ? String(body.name) : undefined,
      wipLimit:
        body.wipLimit !== undefined
          ? body.wipLimit === null || body.wipLimit === ""
            ? null
            : Number(body.wipLimit)
          : undefined,
      color: body.color !== undefined ? String(body.color) : undefined,
    });
    return NextResponse.json({ column });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ columnId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { columnId } = await context.params;
    await deleteColumn(auth.user.id, columnId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

