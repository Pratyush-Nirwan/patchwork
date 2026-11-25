import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import { sendTestWebhook } from "@/lib/webhooks";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ endpointId: string }> }
) {
  try {
    const { orgId } = await requireAdminAuth(req);
    const { endpointId } = await params;
    const result = await sendTestWebhook(endpointId, orgId);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return handleApiError(err);
  }
}
