import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import { generateDiagnosticsBundle } from "@/lib/diagnostics";

export async function GET(req: NextRequest) {
  try {
    await requireAdminAuth(req);
    const diagnostics = await generateDiagnosticsBundle();

    const isDownload = req.nextUrl.searchParams.get("download") === "1";
    if (isDownload) {
      const jsonContent = JSON.stringify(diagnostics, null, 2);
      return new NextResponse(jsonContent, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="patchwork-diagnostics-${Date.now()}.json"`,
        },
      });
    }

    return NextResponse.json({ diagnostics });
  } catch (err) {
    return handleApiError(err);
  }
}

