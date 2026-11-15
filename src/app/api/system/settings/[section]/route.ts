import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/http";
import { requireAdminAuth } from "@/lib/system";
import {
  getSystemSetting,
  setSystemSetting,
  resetSystemSetting,
  SettingKey,
  SETTINGS_SCHEMAS,
  encryptIntegrationToken,
  decryptIntegrationToken,
  IntegrationsSettings,
} from "@/lib/settings";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { AppError } from "@/lib/errors";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ section: string }> }
) {
  try {
    await requireAdminAuth(req);
    const { section } = await params;

    if (!(section in SETTINGS_SCHEMAS)) {
      throw new AppError("Invalid settings section", 404, "SECTION_NOT_FOUND");
    }

    const key = section as SettingKey;
    const settings = await getSystemSetting(key);

    if (key === "integrations") {
      const integrations = settings as IntegrationsSettings;
      const ghDecrypted = decryptIntegrationToken({
        ciphertext: integrations.githubTokenCiphertext,
        iv: integrations.githubTokenIv,
        authTag: integrations.githubTokenAuthTag,
      });
      const glDecrypted = decryptIntegrationToken({
        ciphertext: integrations.gitlabTokenCiphertext,
        iv: integrations.gitlabTokenIv,
        authTag: integrations.gitlabTokenAuthTag,
      });

      return NextResponse.json({
        settings: {
          allowedHosts: integrations.allowedHosts,
          cacheDurationSec: integrations.cacheDurationSec,
          hasGithubToken: Boolean(ghDecrypted || process.env.GITHUB_TOKEN),
          githubTokenMasked: ghDecrypted ? `ghp_••••••••` : process.env.GITHUB_TOKEN ? `env_••••••••` : null,
          hasGitlabToken: Boolean(glDecrypted || process.env.GITLAB_TOKEN),
          gitlabTokenMasked: glDecrypted ? `glpat-••••••••` : process.env.GITLAB_TOKEN ? `env_••••••••` : null,
        },
      });
    }

    return NextResponse.json({ settings });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ section: string }> }
) {
  try {
    const { auth } = await requireAdminAuth(req);
    const { section } = await params;

    if (!(section in SETTINGS_SCHEMAS)) {
      throw new AppError("Invalid settings section", 404, "SECTION_NOT_FOUND");
    }

    const key = section as SettingKey;
    const body = await req.json();

    // Check for special action: sign out all users
    if (key === "security" && body.action === "sign-out-all") {
      await db.delete(sessions);
      return NextResponse.json({
        success: true,
        message: "All user sessions have been terminated",
      });
    }

    let payloadToSave = body;

    if (key === "integrations") {
      const current = await getSystemSetting("integrations");
      let ghCipher = current.githubTokenCiphertext;
      let ghIv = current.githubTokenIv;
      let ghTag = current.githubTokenAuthTag;

      if (body.githubToken !== undefined) {
        if (body.githubToken && !body.githubToken.includes("•")) {
          const enc = encryptIntegrationToken(body.githubToken.trim());
          ghCipher = enc.ciphertext;
          ghIv = enc.iv;
          ghTag = enc.authTag;
        } else if (body.githubToken === null || body.githubToken === "") {
          ghCipher = null;
          ghIv = null;
          ghTag = null;
        }
      }

      let glCipher = current.gitlabTokenCiphertext;
      let glIv = current.gitlabTokenIv;
      let glTag = current.gitlabTokenAuthTag;

      if (body.gitlabToken !== undefined) {
        if (body.gitlabToken && !body.gitlabToken.includes("•")) {
          const enc = encryptIntegrationToken(body.gitlabToken.trim());
          glCipher = enc.ciphertext;
          glIv = enc.iv;
          glTag = enc.authTag;
        } else if (body.gitlabToken === null || body.gitlabToken === "") {
          glCipher = null;
          glIv = null;
          glTag = null;
        }
      }

      payloadToSave = {
        allowedHosts: Array.isArray(body.allowedHosts) ? body.allowedHosts : current.allowedHosts,
        cacheDurationSec: typeof body.cacheDurationSec === "number" ? body.cacheDurationSec : current.cacheDurationSec,
        githubTokenCiphertext: ghCipher,
        githubTokenIv: ghIv,
        githubTokenAuthTag: ghTag,
        gitlabTokenCiphertext: glCipher,
        gitlabTokenIv: glIv,
        gitlabTokenAuthTag: glTag,
      };
    }

    const updated = await setSystemSetting(key, payloadToSave, auth.user.id);
    return NextResponse.json({ success: true, settings: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ section: string }> }
) {
  try {
    const { auth } = await requireAdminAuth(req);
    const { section } = await params;

    if (!(section in SETTINGS_SCHEMAS)) {
      throw new AppError("Invalid settings section", 404, "SECTION_NOT_FOUND");
    }

    const key = section as SettingKey;
    const reset = await resetSystemSetting(key, auth.user.id);

    return NextResponse.json({
      success: true,
      message: `${section} settings reset to default`,
      settings: reset,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
