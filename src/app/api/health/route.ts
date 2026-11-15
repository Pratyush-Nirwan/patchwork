import { NextResponse } from "next/server";
import { pool, ensureMigrated } from "@/db";
import { channel, displayVersion, version } from "@/lib/version";

export async function GET() {
  try {
    await ensureMigrated();
    await pool.query("SELECT 1");
    return NextResponse.json({
      status: "ok",
      version,
      displayVersion,
      channel,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database unavailable";
    return NextResponse.json({ status: "error", error: message }, { status: 503 });
  }
}

