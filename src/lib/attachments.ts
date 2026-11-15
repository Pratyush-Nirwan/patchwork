import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ticketAttachments } from "@/db/schema";
import { requireTicketRole } from "./rbac";
import { AppError, NotFoundError } from "./errors";
import { recordActivity } from "./tickets";
import { realtimeHub } from "./realtime";
import { getSystemSetting } from "./settings";
import { sanitizeFilename } from "./platform";

const ALLOWED_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "text/csv",
  "application/json",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
]);

export function getMaxAttachmentBytes(): number {
  return Number(process.env.MAX_ATTACHMENT_BYTES || 5 * 1024 * 1024);
}

export function getS3Bucket(): string {
  return process.env.S3_BUCKET || "patchwork-test";
}

export function getS3Client(): S3Client {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT || "http://127.0.0.1:9000",
    region: process.env.S3_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || "minioadmin",
      secretAccessKey: process.env.S3_SECRET_KEY || "minioadmin",
    },
    forcePathStyle: true,
  });
}

export function getPublicS3Client(): S3Client {
  return new S3Client({
    endpoint:
      process.env.MINIO_PUBLIC_URL ||
      process.env.S3_ENDPOINT ||
      "http://127.0.0.1:9000",
    region: process.env.S3_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || "minioadmin",
      secretAccessKey: process.env.S3_SECRET_KEY || "minioadmin",
    },
    forcePathStyle: true,
  });
}

let bucketVerified = false;
export async function ensureS3BucketExists(): Promise<void> {
  if (bucketVerified) return;
  const s3 = getS3Client();
  const bucket = getS3Bucket();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    bucketVerified = true;
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    bucketVerified = true;
  }
}

export async function validateAttachmentConstraints(input: {
  filename: string;
  contentType: string;
  sizeBytes: number;
  buffer?: Buffer;
}) {
  const filename = input.filename.trim();
  if (!filename) {
    throw new AppError("Filename is required", 400, "INVALID_FILENAME");
  }

  let maxBytes = getMaxAttachmentBytes();
  let allowedMimes = Array.from(ALLOWED_MIME_TYPES);
  let allowedExts = Array.from(ALLOWED_EXTENSIONS);
  try {
    const config = await getSystemSetting("storage");
    maxBytes = config.maxAttachmentBytes;
    allowedMimes = config.allowedMimeTypes;
    allowedExts = config.allowedExtensions;
  } catch {
    // fallback to defaults
  }

  if (input.sizeBytes <= 0) {
    throw new AppError("File cannot be empty", 400, "EMPTY_FILE");
  }
  if (input.sizeBytes > maxBytes) {
    throw new AppError(
      `File size exceeds maximum limit of ${maxBytes} bytes`,
      413,
      "FILE_TOO_LARGE"
    );
  }

  const extIdx = filename.lastIndexOf(".");
  const ext = extIdx !== -1 ? filename.slice(extIdx).toLowerCase() : "";
  const mime = input.contentType.split(";")[0].trim().toLowerCase();

  const isExtAllowed = allowedExts.some((e) => e.toLowerCase() === ext);
  const isMimeAllowed = allowedMimes.some((m) => m.toLowerCase() === mime);

  if (!isExtAllowed || !isMimeAllowed) {
    throw new AppError(
      `Unsupported file type (${mime || ext}). Allowed: ${allowedExts.join(", ")}`,
      400,
      "UNSUPPORTED_FILE_TYPE"
    );
  }

  if (input.buffer) {
    validateFileContentSignature(mime, ext, input.buffer);
  }
}

function validateFileContentSignature(mime: string, ext: string, buf: Buffer): void {
  if (mime === "image/png" || ext === ".png") {
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buf.length < 8 || !buf.subarray(0, 8).equals(pngSig)) {
      throw new AppError("File content does not match PNG signature", 400, "INVALID_FILE_CONTENT");
    }
  } else if (mime === "image/jpeg" || ext === ".jpg" || ext === ".jpeg") {
    if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
      throw new AppError("File content does not match JPEG signature", 400, "INVALID_FILE_CONTENT");
    }
  } else if (mime === "image/gif" || ext === ".gif") {
    const hdr = buf.subarray(0, 6).toString("ascii");
    if (hdr !== "GIF87a" && hdr !== "GIF89a") {
      throw new AppError("File content does not match GIF signature", 400, "INVALID_FILE_CONTENT");
    }
  } else if (mime === "image/webp" || ext === ".webp") {
    if (
      buf.length < 12 ||
      buf.subarray(0, 4).toString("ascii") !== "RIFF" ||
      buf.subarray(8, 12).toString("ascii") !== "WEBP"
    ) {
      throw new AppError("File content does not match WebP signature", 400, "INVALID_FILE_CONTENT");
    }
  } else if (mime === "application/pdf" || ext === ".pdf") {
    if (buf.length < 5 || buf.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new AppError("File content does not match PDF signature", 400, "INVALID_FILE_CONTENT");
    }
  } else if (mime.startsWith("text/") || mime === "application/json") {
    if (buf.includes(0x00)) {
      throw new AppError("Binary content is not allowed in text attachments", 400, "INVALID_FILE_CONTENT");
    }
  }
}

export async function extractAttachmentText(
  filename: string,
  contentType: string,
  buffer: Buffer
): Promise<string> {
  const lowerName = filename.toLowerCase();
  const mime = contentType.toLowerCase();

  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".markdown") ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".json")
  ) {
    return buffer.toString("utf8").slice(0, 100_000);
  }

  if (mime === "application/pdf" || lowerName.endsWith(".pdf")) {
    try {
      const pdfParseModule = await import("pdf-parse");
      const pdfParse = pdfParseModule.default || pdfParseModule;
      const parsed = await pdfParse(buffer);
      if (parsed && typeof parsed.text === "string" && parsed.text.trim()) {
        return parsed.text.trim().slice(0, 100_000);
      }
    } catch {
      // Fallback: extract printable text literals inside PDF parentheses
    }
    const raw = buffer.toString("latin1");
    const matches = Array.from(raw.matchAll(/\(([^()\\]{2,})\)/g)).map((m) => m[1]);
    return matches.join(" ").slice(0, 100_000);
  }

  return "";
}

export async function createPresignedUploadUrl(
  actorId: string,
  ticketId: string,
  input: { filename: string; contentType: string; sizeBytes: number }
) {
  const { ticket } = await requireTicketRole(actorId, ticketId, "member");
  await validateAttachmentConstraints(input);
  await ensureS3BucketExists();

  const safeName = sanitizeFilename(input.filename);
  const storageKey = `${ticket.orgId}/${ticket.teamId}/${ticket.id}/${randomUUID().toLowerCase()}-${safeName.toLowerCase()}`;
  const s3 = getPublicS3Client();
  const command = new PutObjectCommand({
    Bucket: getS3Bucket(),
    Key: storageKey,
    ContentType: input.contentType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
  return { uploadUrl, storageKey };
}

export async function uploadTicketAttachment(
  actorId: string,
  ticketId: string,
  input: {
    filename: string;
    contentType: string;
    buffer: Buffer;
  }
) {
  const { ticket } = await requireTicketRole(actorId, ticketId, "member");
  await validateAttachmentConstraints({
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: input.buffer.byteLength,
    buffer: input.buffer,
  });
  await ensureS3BucketExists();

  const safeName = sanitizeFilename(input.filename);
  const storageKey = `${ticket.orgId}/${ticket.teamId}/${ticket.id}/${randomUUID().toLowerCase()}-${safeName.toLowerCase()}`;
  const s3 = getS3Client();
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: getS3Bucket(),
        Key: storageKey,
        ContentType: input.contentType,
        ContentLength: input.buffer.byteLength,
        Body: input.buffer,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "upload error";
    throw new AppError(`Failed to upload attachment to MinIO (${msg})`, 502);
  }

  const extractedText = await extractAttachmentText(
    input.filename,
    input.contentType,
    input.buffer
  );

  const [attachment] = await db
    .insert(ticketAttachments)
    .values({
      ticketId: ticket.id,
      orgId: ticket.orgId,
      teamId: ticket.teamId,
      uploaderId: actorId,
      filename: input.filename.trim(),
      contentType: input.contentType,
      sizeBytes: input.buffer.byteLength,
      storageKey,
      extractedText,
    })
    .returning();

  const downloadUrl = await getAttachmentDownloadUrl(actorId, attachment.id);

  await recordActivity({
    ticketId: ticket.id,
    actorId,
    action: "attachment.added",
    details: {
      attachmentId: attachment.id,
      filename: attachment.filename,
      sizeBytes: attachment.sizeBytes,
    },
  });

  await realtimeHub.publish({
    type: "attachment.added",
    orgId: ticket.orgId,
    teamId: ticket.teamId,
    boardId: ticket.boardId,
    ticketId: ticket.id,
    actorId,
    payload: {
      attachment: {
        ...attachment,
        downloadUrl,
      },
    },
  });

  return {
    ...attachment,
    downloadUrl,
  };
}

export async function getAttachmentDownloadUrl(
  actorId: string,
  attachmentId: string
): Promise<string> {
  const [attachment] = await db
    .select()
    .from(ticketAttachments)
    .where(eq(ticketAttachments.id, attachmentId))
    .limit(1);

  if (!attachment) {
    throw new NotFoundError("Attachment not found");
  }

  await requireTicketRole(actorId, attachment.ticketId, "viewer");

  const s3 = getPublicS3Client();
  const safeDownloadName = sanitizeFilename(attachment.filename);
  const command = new GetObjectCommand({
    Bucket: getS3Bucket(),
    Key: attachment.storageKey,
    ResponseContentDisposition: `inline; filename="${safeDownloadName.replace(/"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(safeDownloadName)}`,
  });

  return getSignedUrl(s3, command, { expiresIn: 3600 });
}

export async function deleteAttachment(actorId: string, attachmentId: string) {
  const [attachment] = await db
    .select()
    .from(ticketAttachments)
    .where(eq(ticketAttachments.id, attachmentId))
    .limit(1);

  if (!attachment) throw new NotFoundError("Attachment not found");

  const { ticket } = await requireTicketRole(actorId, attachment.ticketId, "member");

  const s3 = getS3Client();
  await s3
    .send(
      new DeleteObjectCommand({
        Bucket: getS3Bucket(),
        Key: attachment.storageKey,
      })
    )
    .catch(() => undefined);

  await db.delete(ticketAttachments).where(eq(ticketAttachments.id, attachmentId));

  await recordActivity({
    ticketId: ticket.id,
    actorId,
    action: "attachment.removed",
    details: {
      attachmentId: attachment.id,
      filename: attachment.filename,
    },
  });

  await realtimeHub.publish({
    type: "attachment.removed",
    orgId: ticket.orgId,
    teamId: ticket.teamId,
    boardId: ticket.boardId,
    ticketId: ticket.id,
    actorId,
    payload: { attachmentId: attachment.id },
  });
}

export async function listAllS3Objects(): Promise<
  Array<{ key: string; sizeBytes: number; lastModified?: Date }>
> {
  await ensureS3BucketExists();
  const s3 = getS3Client();
  const bucket = getS3Bucket();
  const results: Array<{ key: string; sizeBytes: number; lastModified?: Date }> = [];
  let continuationToken: string | undefined = undefined;

  do {
    const res: ListObjectsV2CommandOutput = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      })
    );
    if (res.Contents) {
      for (const item of res.Contents) {
        if (item.Key) {
          results.push({
            key: item.Key,
            sizeBytes: item.Size || 0,
            lastModified: item.LastModified,
          });
        }
      }
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  return results;
}

export async function findOrphanedAttachments(): Promise<{
  orphans: Array<{ key: string; sizeBytes: number }>;
  totalBytes: number;
  totalS3Objects: number;
  totalDbRecords: number;
}> {
  const allS3 = await listAllS3Objects();
  const dbRows = await db
    .select({ storageKey: ticketAttachments.storageKey })
    .from(ticketAttachments);

  const dbKeys = new Set(dbRows.map((r) => r.storageKey));
  const orphans = allS3
    .filter((obj) => !dbKeys.has(obj.key))
    .map((o) => ({ key: o.key, sizeBytes: o.sizeBytes }));

  const totalBytes = orphans.reduce((sum, o) => sum + o.sizeBytes, 0);

  return {
    orphans,
    totalBytes,
    totalS3Objects: allS3.length,
    totalDbRecords: dbRows.length,
  };
}

export async function deleteOrphanedAttachments(
  keys: string[]
): Promise<{ deletedCount: number }> {
  if (keys.length === 0) return { deletedCount: 0 };
  const s3 = getS3Client();
  const bucket = getS3Bucket();

  // Protect valid DB records from accidental deletion
  const dbRows = await db
    .select({ storageKey: ticketAttachments.storageKey })
    .from(ticketAttachments);
  const dbKeys = new Set(dbRows.map((r) => r.storageKey));
  const safeKeysToDelete = keys.filter((k) => !dbKeys.has(k));

  let deletedCount = 0;
  // Batch in chunks of 500
  const chunkSize = 500;
  for (let i = 0; i < safeKeysToDelete.length; i += chunkSize) {
    const chunk = safeKeysToDelete.slice(i, i + chunkSize);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
          Quiet: true,
        },
      })
    );
    deletedCount += chunk.length;
  }

  return { deletedCount };
}


