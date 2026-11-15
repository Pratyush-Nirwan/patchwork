import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireRequestAuth } from "@/lib/http";
import {
  uploadTicketAttachment,
  createPresignedUploadUrl,
} from "@/lib/attachments";
import { AppError } from "@/lib/errors";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ ticketId: string }> }
) {
  try {
    const auth = await requireRequestAuth(req);
    const { ticketId } = await context.params;
    const contentTypeHeader = req.headers.get("content-type") || "";

    if (contentTypeHeader.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!file || !(file instanceof File)) {
        throw new AppError("Multipart 'file' field is required", 400);
      }
      const arrayBuf = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const attachment = await uploadTicketAttachment(auth.user.id, ticketId, {
        filename: file.name,
        contentType: file.type || "text/plain",
        buffer,
      });
      return NextResponse.json({ attachment }, { status: 201 });
    }

    const body = await req.json();
    if (body.presignOnly) {
      const presigned = await createPresignedUploadUrl(auth.user.id, ticketId, {
        filename: String(body.filename || ""),
        contentType: String(body.contentType || "text/plain"),
        sizeBytes: Number(body.sizeBytes || 0),
      });
      return NextResponse.json(presigned);
    }

    const rawContent = body.contentBase64
      ? Buffer.from(String(body.contentBase64), "base64")
      : Buffer.from(String(body.content ?? ""), "utf8");

    const attachment = await uploadTicketAttachment(auth.user.id, ticketId, {
      filename: String(body.filename || "attachment.txt"),
      contentType: String(body.contentType || "text/plain"),
      buffer: rawContent,
    });
    return NextResponse.json({ attachment }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

