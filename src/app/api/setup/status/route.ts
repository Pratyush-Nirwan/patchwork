import { NextResponse } from "next/server";
import { ensureMigrated } from "@/db";
import { getSetupStatus } from "@/lib/setup";
import { handleApiError } from "@/lib/http";

export async function GET() {
  try {
    await ensureMigrated();
    const status = await getSetupStatus();
    return NextResponse.json(status);
  } catch (err) {
    return handleApiError(err);
  }
}

