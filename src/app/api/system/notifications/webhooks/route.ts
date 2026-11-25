import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { webhookEndpoints } from "@/db/schema";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import {
  createWebhookEndpoint,
  sanitizeEndpointForApi,
  WEBHOOK_EVENT_TYPES,
} from "@/lib/webhooks";
import { AppError } from "@/lib/errors";

const CreateWebhookSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().min(1).max(1000),
  format: z.enum(["generic", "slack", "discord", "mattermost"]).default("generic"),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1),
  scopeTeamIds: z.array(z.string().uuid()).default([]),
  scopeProjectIds: z.array(z.string().uuid()).default([]),
  scopeBoardIds: z.array(z.string().uuid()).default([]),
  enabled: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  try {
    const { orgId } = await requireAdminAuth(req);
    const rows = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.orgId, orgId))
      .orderBy(desc(webhookEndpoints.createdAt));

    return NextResponse.json({
      endpoints: rows.map(sanitizeEndpointForApi),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { auth, orgId } = await requireAdminAuth(req);
    const body = await req.json();
    const parsed = CreateWebhookSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message || "Invalid webhook configuration", 400);
    }
    const created = await createWebhookEndpoint(orgId, auth.user.id, parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
