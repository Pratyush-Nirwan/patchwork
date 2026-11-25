import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { webhookEndpoints } from "@/db/schema";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import {
  sanitizeEndpointForApi,
  validateAndResolveWebhookTarget,
  WEBHOOK_EVENT_TYPES,
} from "@/lib/webhooks";
import { getSystemSetting } from "@/lib/settings";
import { AppError, NotFoundError } from "@/lib/errors";

const UpdateWebhookSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  url: z.string().min(1).max(1000).optional(),
  format: z.enum(["generic", "slack", "discord", "mattermost"]).optional(),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).optional(),
  scopeTeamIds: z.array(z.string().uuid()).optional(),
  scopeProjectIds: z.array(z.string().uuid()).optional(),
  scopeBoardIds: z.array(z.string().uuid()).optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ endpointId: string }> }
) {
  try {
    const { orgId } = await requireAdminAuth(req);
    const { endpointId } = await params;
    const body = await req.json();
    const parsed = UpdateWebhookSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message || "Invalid webhook update", 400);
    }

    const [existing] = await db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.orgId, orgId)))
      .limit(1);
    if (!existing) throw new NotFoundError("Webhook endpoint not found");

    if (parsed.data.url !== undefined) {
      const settings = await getSystemSetting("notifications");
      await validateAndResolveWebhookTarget(parsed.data.url, settings.allowPrivateNetworkWebhooks);
    }

    const [updated] = await db
      .update(webhookEndpoints)
      .set({
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.url !== undefined ? { url: parsed.data.url.trim() } : {}),
        ...(parsed.data.format !== undefined ? { format: parsed.data.format } : {}),
        ...(parsed.data.events !== undefined ? { events: parsed.data.events } : {}),
        ...(parsed.data.scopeTeamIds !== undefined ? { scopeTeamIds: parsed.data.scopeTeamIds } : {}),
        ...(parsed.data.scopeProjectIds !== undefined ? { scopeProjectIds: parsed.data.scopeProjectIds } : {}),
        ...(parsed.data.scopeBoardIds !== undefined ? { scopeBoardIds: parsed.data.scopeBoardIds } : {}),
        ...(parsed.data.enabled !== undefined
          ? {
              enabled: parsed.data.enabled,
              ...(parsed.data.enabled
                ? { consecutiveFailures: 0, disabledReason: null, disabledAt: null }
                : {}),
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(webhookEndpoints.id, endpointId))
      .returning();

    return NextResponse.json({ endpoint: sanitizeEndpointForApi(updated) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ endpointId: string }> }
) {
  try {
    const { orgId } = await requireAdminAuth(req);
    const { endpointId } = await params;
    const deleted = await db
      .delete(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.orgId, orgId)))
      .returning({ id: webhookEndpoints.id });
    if (deleted.length === 0) throw new NotFoundError("Webhook endpoint not found");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
