import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import { getS3Bucket } from "@/lib/attachments";
import { defaultMinioDataDir } from "@/lib/platform";

export async function GET(req: NextRequest) {
  try {
    await requireAdminAuth(req);

    const dbUrl = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/patchwork";
    let dbHost = "localhost";
    let dbUser = "postgres";
    let dbName = "patchwork";
    try {
      const u = new URL(dbUrl);
      dbHost = u.hostname || dbHost;
      dbUser = u.username || dbUser;
      dbName = u.pathname.replace(/^\//, "") || dbName;
    } catch {
      // fallback
    }

    const pgDumpCommand = `pg_dump -h ${dbHost} -U ${dbUser} -d ${dbName} -F c -b -v -f patchwork-backup.dump`;
    const minioBucket = getS3Bucket();
    const minioDataPath = process.env.MINIO_DATA_DIR || defaultMinioDataDir(minioBucket);

    return NextResponse.json({
      commands: {
        pgDumpCommand,
        minioBucket,
        minioDataPath,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

