import { NextRequest, NextResponse } from "next/server";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import { getS3Client, getS3Bucket } from "@/lib/attachments";
import { db } from "@/db";
import { ticketAttachments } from "@/db/schema";
import { sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    await requireAdminAuth(req);

    const bucket = getS3Bucket();
    const s3 = getS3Client();
    let status: "healthy" | "unhealthy" = "healthy";
    let latencyMs = -1;

    try {
      const start = Date.now();
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
      latencyMs = Date.now() - start;
    } catch {
      status = "unhealthy";
    }

    const [stats] = await db
      .select({
        totalBytes: sql<number>`coalesce(sum(${ticketAttachments.sizeBytes}), 0)::bigint`,
        totalCount: sql<number>`count(*)::int`,
      })
      .from(ticketAttachments);

    return NextResponse.json({
      minio: {
        status,
        bucket,
        latencyMs,
      },
      storageUsedBytes: Number(stats?.totalBytes || 0),
      totalAttachmentsCount: Number(stats?.totalCount || 0),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

