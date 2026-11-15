import { NextRequest } from "next/server";
import { serveDocsRequest } from "@/lib/docs-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { path: rawSegments } = await context.params;
  return serveDocsRequest(request, rawSegments);
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  const { path: rawSegments } = await context.params;
  return serveDocsRequest(request, rawSegments);
}
