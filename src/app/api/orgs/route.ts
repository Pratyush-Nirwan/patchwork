import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { createOrg, listUserOrgs } from "@/lib/hierarchy";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req, { skipCsrf: true });
    const orgs = await listUserOrgs(auth.user.id);
    return NextResponse.json({ orgs });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    const body = await req.json();
    const org = await createOrg(auth.user.id, {
      name: String(body.name || ""),
      slug: body.slug ? String(body.slug) : undefined,
    });
    return NextResponse.json({ org }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

