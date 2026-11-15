import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import { PERMISSIONS_MATRIX } from "@/lib/rbac";

export async function GET(req: NextRequest) {
  try {
    await requireAdminAuth(req);
    return NextResponse.json({
      roles: ["admin", "lead", "member", "viewer"],
      permissions: PERMISSIONS_MATRIX,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

