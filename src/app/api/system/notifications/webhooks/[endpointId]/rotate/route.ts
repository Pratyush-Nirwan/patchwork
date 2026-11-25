import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import { rotateWebhookSecret } from "@/lib/webhooks";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ endpointId: string }> }
) {
  try {
    const { orgId } = await requireAdminAuth(req);
    const { endpointId } = await params;
    const rotated = await rotateWebhookSecret(endpointId, orgId);
    return NextResponse.json(rotated);
  } catch (err) {
    return handleApiError(err);
  }
}
