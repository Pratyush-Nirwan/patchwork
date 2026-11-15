import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { createBoard, listProjectBoards } from "@/lib/hierarchy";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req, { skipCsrf: true });
    const { projectId } = await context.params;
    const boards = await listProjectBoards(auth.user.id, projectId);
    return NextResponse.json({ boards });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { projectId } = await context.params;
    const body = await req.json();
    const board = await createBoard(auth.user.id, projectId, {
      name: String(body.name || ""),
      description: body.description ? String(body.description) : undefined,
      columns: Array.isArray(body.columns) ? body.columns : undefined,
    });
    return NextResponse.json({ board }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

