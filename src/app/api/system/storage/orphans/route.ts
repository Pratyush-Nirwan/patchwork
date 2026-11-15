import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import {
  findOrphanedAttachments,
  deleteOrphanedAttachments,
} from "@/lib/attachments";
import { AppError } from "@/lib/errors";

export async function GET(req: NextRequest) {
  try {
    await requireAdminAuth(req);
    const result = await findOrphanedAttachments();
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdminAuth(req);
    const body = await req.json();
    const keys = Array.isArray(body.keys) ? (body.keys as string[]) : [];

    if (keys.length === 0) {
      throw new AppError("No orphan keys specified for deletion", 400);
    }

    const { deletedCount } = await deleteOrphanedAttachments(keys);
    return NextResponse.json({
      success: true,
      deletedCount,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

