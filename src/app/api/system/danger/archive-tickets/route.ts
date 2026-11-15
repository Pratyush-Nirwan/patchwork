import { NextRequest, NextResponse } from "next/server";
import { eq, and, lt, count } from "drizzle-orm";
import { db } from "@/db";
import { tickets } from "@/db/schema";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import { AppError } from "@/lib/errors";

export async function GET(req: NextRequest) {
  try {
    const { orgId } = await requireAdminAuth(req);
    const days = Math.max(1, parseInt(req.nextUrl.searchParams.get("days") || "30", 10));
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [result] = await db
      .select({ count: count() })
      .from(tickets)
      .where(and(eq(tickets.orgId, orgId), lt(tickets.createdAt, cutoffDate)));

    return NextResponse.json({
      days,
      cutoffDate: cutoffDate.toISOString(),
      affectedCount: Number(result?.count || 0),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { orgId } = await requireAdminAuth(req);
    const body = await req.json();

    const days = Math.max(1, parseInt(String(body.days || "30"), 10));
    const confirmText = String(body.confirmText || "").trim();

    if (confirmText !== "ARCHIVE TICKETS") {
      throw new AppError(
        'Confirmation text must match "ARCHIVE TICKETS"',
        400,
        "INVALID_CONFIRMATION"
      );
    }

    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [countBefore] = await db
      .select({ count: count() })
      .from(tickets)
      .where(and(eq(tickets.orgId, orgId), lt(tickets.createdAt, cutoffDate)));

    const affectedCount = Number(countBefore?.count || 0);

    if (affectedCount > 0) {
      await db
        .delete(tickets)
        .where(and(eq(tickets.orgId, orgId), lt(tickets.createdAt, cutoffDate)));
    }

    return NextResponse.json({
      success: true,
      affectedCount,
      cutoffDate: cutoffDate.toISOString(),
      message: `Archived and purged ${affectedCount} tickets older than ${days} days`,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

