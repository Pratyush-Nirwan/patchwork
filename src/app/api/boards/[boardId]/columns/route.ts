import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { createColumn, reorderColumns } from "@/lib/hierarchy";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ boardId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { boardId } = await context.params;
    const body = await req.json();
    const column = await createColumn(auth.user.id, boardId, {
      name: String(body.name || ""),
      wipLimit: body.wipLimit !== undefined && body.wipLimit !== null ? Number(body.wipLimit) : null,
      color: body.color ? String(body.color) : undefined,
    });
    return NextResponse.json({ column }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ boardId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { boardId } = await context.params;
    const body = await req.json();
    const columns = await reorderColumns(
      auth.user.id,
      boardId,
      body && typeof body === "object" && "columnId" in body
        ? {
            columnId: String(body.columnId),
            position: typeof body.position === "number" ? body.position : undefined,
            columnIds: Array.isArray(body.columnIds) ? body.columnIds.map(String) : undefined,
          }
        : Array.isArray(body?.columnIds)
        ? body.columnIds.map(String)
        : Array.isArray(body)
        ? body.map(String)
        : []
    );
    return NextResponse.json({ columns });
  } catch (err) {
    return handleApiError(err);
  }
}

