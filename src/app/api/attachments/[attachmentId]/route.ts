import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import { getAttachmentDownloadUrl, deleteAttachment } from "@/lib/attachments";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ attachmentId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req, { skipCsrf: true });
    const { attachmentId } = await context.params;
    const downloadUrl = await getAttachmentDownloadUrl(auth.user.id, attachmentId);
    return NextResponse.json({ downloadUrl });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ attachmentId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { attachmentId } = await context.params;
    await deleteAttachment(auth.user.id, attachmentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

