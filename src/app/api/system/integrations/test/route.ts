import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import { testForgeConnection } from "@/lib/links";
import { AppError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    await requireAdminAuth(req);
    const body = await req.json();

    const provider = body.provider as "github" | "gitlab";
    if (provider !== "github" && provider !== "gitlab") {
      throw new AppError("Provider must be 'github' or 'gitlab'", 400);
    }

    const token = typeof body.token === "string" && body.token.trim() && !body.token.includes("•")
      ? body.token.trim()
      : undefined;

    const result = await testForgeConnection(provider, token);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

