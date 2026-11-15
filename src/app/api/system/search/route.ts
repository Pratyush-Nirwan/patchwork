import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import { getSearchIndexStatus, rebuildSearchIndex } from "@/lib/search";

export async function GET(req: NextRequest) {
  try {
    await requireAdminAuth(req);
    const status = await getSearchIndexStatus();
    return NextResponse.json({ status });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdminAuth(req);
    const result = await rebuildSearchIndex();
    return NextResponse.json({
      success: true,
      message: "Search indexes rebuilt successfully",
      ...result,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

