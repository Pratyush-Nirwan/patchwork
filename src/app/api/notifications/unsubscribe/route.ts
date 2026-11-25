import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userNotificationPreferences } from "@/db/schema";
import { verifyUnsubscribeToken } from "@/lib/email-notifications";
import { getUserNotificationPrefs } from "@/lib/watchers";

async function applyUnsubscribe(token: string) {
  const verified = verifyUnsubscribeToken(token);
  if (!verified) return null;

  const current = await getUserNotificationPrefs(verified.userId);
  const patch: Partial<typeof userNotificationPreferences.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (verified.category === "mention") patch.emailMentions = "off";
  else if (verified.category === "assignment") patch.emailAssignments = "off";
  else if (verified.category === "watched_update") patch.emailWatched = "off";
  else if (verified.category === "digest") {
    if (current.emailMentions === "digest") patch.emailMentions = "off";
    if (current.emailAssignments === "digest") patch.emailAssignments = "off";
    if (current.emailWatched === "digest") patch.emailWatched = "off";
  }

  await db
    .insert(userNotificationPreferences)
    .values({
      userId: verified.userId,
      ...patch,
    })
    .onConflictDoUpdate({
      target: userNotificationPreferences.userId,
      set: patch,
    });

  return verified;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  const verified = await applyUnsubscribe(token);
  if (!verified) {
    return new NextResponse(
      "<!doctype html><html><body><p>This unsubscribe link is invalid or has expired.</p></body></html>",
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
  return new NextResponse(
    `<!doctype html><html><body><p>You have been unsubscribed from ${verified.category.replace("_", " ")} emails.</p></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : req.nextUrl.searchParams.get("token") || "";
  const verified = await applyUnsubscribe(token);
  if (!verified) {
    return NextResponse.json({ error: "Invalid or expired unsubscribe token" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, category: verified.category });
}
