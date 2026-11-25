import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { userNotificationPreferences } from "@/db/schema";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { getUserNotificationPrefs } from "@/lib/watchers";
import { getSystemSetting } from "@/lib/settings";
import { AppError } from "@/lib/errors";

const UpdatePrefsSchema = z.object({
  inAppMentions: z.boolean().optional(),
  inAppAssignments: z.boolean().optional(),
  inAppWatched: z.boolean().optional(),
  emailMentions: z.enum(["off", "immediate", "digest"]).optional(),
  emailAssignments: z.enum(["off", "immediate", "digest"]).optional(),
  emailWatched: z.enum(["off", "digest"]).optional(),
  digestFrequency: z.enum(["daily", "weekly"]).optional(),
  digestHour: z.number().int().min(0).max(23).optional(),
  digestDay: z.number().int().min(0).max(6).optional(),
  autoWatchCreator: z.boolean().optional(),
  autoWatchAssignee: z.boolean().optional(),
  autoWatchCommenter: z.boolean().optional(),
  autoWatchMentioned: z.boolean().optional(),
  presenceEnabled: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req, { skipCsrf: true });
    const [prefs, orgSettings] = await Promise.all([
      getUserNotificationPrefs(auth.user.id),
      getSystemSetting("notifications"),
    ]);
    return NextResponse.json({
      preferences: prefs,
      smtpConfigured: Boolean(orgSettings.smtp.enabled && orgSettings.smtp.host && orgSettings.smtp.fromAddress),
      defaultTimezone: orgSettings.defaultTimezone,
      orgPresenceEnabled: orgSettings.presenceEnabled,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    const body = await req.json();
    const parsed = UpdatePrefsSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message || "Invalid notification preferences", 400);
    }

    const current = await getUserNotificationPrefs(auth.user.id);
    const merged = {
      userId: auth.user.id,
      inAppMentions: parsed.data.inAppMentions ?? current.inAppMentions,
      inAppAssignments: parsed.data.inAppAssignments ?? current.inAppAssignments,
      inAppWatched: parsed.data.inAppWatched ?? current.inAppWatched,
      emailMentions: parsed.data.emailMentions ?? current.emailMentions,
      emailAssignments: parsed.data.emailAssignments ?? current.emailAssignments,
      emailWatched: parsed.data.emailWatched ?? current.emailWatched,
      digestFrequency: parsed.data.digestFrequency ?? current.digestFrequency,
      digestHour: parsed.data.digestHour ?? current.digestHour,
      digestDay: parsed.data.digestDay ?? current.digestDay,
      autoWatchCreator: parsed.data.autoWatchCreator ?? current.autoWatchCreator,
      autoWatchAssignee: parsed.data.autoWatchAssignee ?? current.autoWatchAssignee,
      autoWatchCommenter: parsed.data.autoWatchCommenter ?? current.autoWatchCommenter,
      autoWatchMentioned: parsed.data.autoWatchMentioned ?? current.autoWatchMentioned,
      presenceEnabled: parsed.data.presenceEnabled ?? current.presenceEnabled,
      updatedAt: new Date(),
    };

    await db
      .insert(userNotificationPreferences)
      .values(merged)
      .onConflictDoUpdate({
        target: userNotificationPreferences.userId,
        set: {
          inAppMentions: merged.inAppMentions,
          inAppAssignments: merged.inAppAssignments,
          inAppWatched: merged.inAppWatched,
          emailMentions: merged.emailMentions,
          emailAssignments: merged.emailAssignments,
          emailWatched: merged.emailWatched,
          digestFrequency: merged.digestFrequency,
          digestHour: merged.digestHour,
          digestDay: merged.digestDay,
          autoWatchCreator: merged.autoWatchCreator,
          autoWatchAssignee: merged.autoWatchAssignee,
          autoWatchCommenter: merged.autoWatchCommenter,
          autoWatchMentioned: merged.autoWatchMentioned,
          presenceEnabled: merged.presenceEnabled,
          updatedAt: merged.updatedAt,
        },
      });

    return NextResponse.json({ preferences: merged });
  } catch (err) {
    return handleApiError(err);
  }
}
