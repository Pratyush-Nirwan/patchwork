import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { getBoardWithDetails, updateBoard, deleteBoard } from "@/lib/hierarchy";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ boardId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req, { skipCsrf: true });
    const { boardId } = await context.params;
    const data = await getBoardWithDetails(auth.user.id, boardId);
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ boardId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { boardId } = await context.params;
    const body = await req.json();
    const board = await updateBoard(auth.user.id, boardId, {
      name: body.name !== undefined ? String(body.name) : undefined,
      description: body.description !== undefined ? String(body.description) : undefined,
    });
    return NextResponse.json({ board });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ boardId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { boardId } = await context.params;
    await deleteBoard(auth.user.id, boardId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

