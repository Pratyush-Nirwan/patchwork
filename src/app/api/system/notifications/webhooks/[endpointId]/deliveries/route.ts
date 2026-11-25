import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { webhookDeliveries, webhookEndpoints } from "@/db/schema";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import { listWebhookDeliveries } from "@/lib/webhooks";
import { AppError, NotFoundError } from "@/lib/errors";
import { backgroundWorker } from "@/lib/worker";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ endpointId: string }> }
) {
  try {
    const { orgId } = await requireAdminAuth(req);
    const { endpointId } = await params;
    const [ep] = await db
      .select({ id: webhookEndpoints.id })
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.orgId, orgId)))
      .limit(1);
    if (!ep) throw new NotFoundError("Webhook endpoint not found");

    const deliveries = await listWebhookDeliveries(endpointId);
    return NextResponse.json({ deliveries });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ endpointId: string }> }
) {
  try {
    const { orgId } = await requireAdminAuth(req);
    const { endpointId } = await params;
    const body = await req.json();
    const deliveryId = typeof body.deliveryId === "string" ? body.deliveryId : "";
    if (!deliveryId) throw new AppError("deliveryId is required", 400);

    const [ep] = await db
      .select({ id: webhookEndpoints.id })
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.orgId, orgId)))
      .limit(1);
    if (!ep) throw new NotFoundError("Webhook endpoint not found");

    const updated = await db
      .update(webhookDeliveries)
      .set({ status: "pending", nextAttemptAt: new Date(), lastError: null })
      .where(
        and(
          eq(webhookDeliveries.id, deliveryId),
          eq(webhookDeliveries.endpointId, endpointId)
        )
      )
      .returning({ id: webhookDeliveries.id });
    if (updated.length === 0) throw new NotFoundError("Delivery not found");

    backgroundWorker.triggerTick();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
