import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { orgs } from "@/db/schema";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import { slugify } from "@/lib/slug";
import { AppError } from "@/lib/errors";

export async function GET(req: NextRequest) {
  try {
    const { org } = await requireAdminAuth(req);
    return NextResponse.json({ org });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { orgId, org } = await requireAdminAuth(req);
    const body = await req.json();

    const updates: Partial<typeof orgs.$inferInsert> = {};
    let slugChanged = false;

    if (typeof body.name === "string" && body.name.trim()) {
      updates.name = body.name.trim();
    }

    if (typeof body.description === "string") {
      updates.description = body.description.trim();
    }

    if (typeof body.slug === "string" && body.slug.trim()) {
      const newSlug = slugify(body.slug.trim());
      if (!newSlug) {
        throw new AppError("Invalid organization slug", 400, "INVALID_SLUG");
      }
      if (newSlug !== org.slug) {
        const [existing] = await db
          .select({ id: orgs.id })
          .from(orgs)
          .where(sql`lower(${orgs.slug}) = lower(${newSlug})`)
          .limit(1);

        if (existing && existing.id !== orgId) {
          throw new AppError(
            "This organization slug is already taken",
            409,
            "SLUG_TAKEN"
          );
        }
        updates.slug = newSlug;
        slugChanged = true;
      }
    }

    if (Object.keys(updates).length > 0) {
      await db.update(orgs).set(updates).where(eq(orgs.id, orgId));
    }

    const [updatedOrg] = await db
      .select()
      .from(orgs)
      .where(eq(orgs.id, orgId))
      .limit(1);

    return NextResponse.json({
      org: updatedOrg,
      slugChanged,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

