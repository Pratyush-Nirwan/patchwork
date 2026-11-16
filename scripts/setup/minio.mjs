import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { getSystemInfo } from "../lib/platform.mjs";
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { checkMinioBinary } from "./preflight.mjs";

export async function isMinioHealthy(endpoint = "http://127.0.0.1:9000") {
  try {
    const res = await fetch(`${endpoint.replace(/\/$/, "")}/minio/health/live`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function createS3Client({
  endpoint = "http://127.0.0.1:9000",
  region = "us-east-1",
  accessKeyId = "minioadmin",
  secretAccessKey = "minioadmin",
}) {
  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

export async function checkMinioBucketReachable({
  endpoint = "http://127.0.0.1:9000",
  region = "us-east-1",
  accessKeyId = "minioadmin",
  secretAccessKey = "minioadmin",
  bucket = "patchwork",
}) {
  const s3 = createS3Client({ endpoint, region, accessKeyId, secretAccessKey });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return { reachable: true, bucketExists: true };
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === "NotFound" || err?.name === "NoSuchBucket") {
      return { reachable: true, bucketExists: false };
    }
    return {
      reachable: false,
      bucketExists: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function ensureMinioServerRunning({
  projectDir = process.cwd(),
  dataDir,
  endpoint = "http://127.0.0.1:9000",
  consolePort = 9001,
  accessKeyId = "minioadmin",
  secretAccessKey = "minioadmin",
}) {
  const targetDataDir = dataDir || path.join(projectDir, ".minio-data");
  fs.mkdirSync(targetDataDir, { recursive: true });

  const binCheck = checkMinioBinary(projectDir);
  if (!binCheck.passed) {
    throw new Error(`${binCheck.detail}. ${binCheck.fixHint}`);
  }

  if (await isMinioHealthy(endpoint)) {
    return { started: false, endpoint, dataDir: targetDataDir };
  }

  const parsedUrl = new URL(endpoint);
  const apiHostPort = `${parsedUrl.hostname}:${parsedUrl.port || 9000}`;
  const consoleHostPort = `127.0.0.1:${consolePort}`;

  const child = spawn(
    binCheck.binaryPath,
    [
      "server",
      targetDataDir,
      "--address",
      apiHostPort,
      "--console-address",
      consoleHostPort,
    ],
    {
      env: {
        ...process.env,
        MINIO_ROOT_USER: accessKeyId,
        MINIO_ROOT_PASSWORD: secretAccessKey,
      },
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }
  );
  child.unref();

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 400));
    if (await isMinioHealthy(endpoint)) {
      return { started: true, pid: child.pid, endpoint, dataDir: targetDataDir };
    }
  }

  throw new Error(`MinIO failed to start on ${endpoint}`);
}

export async function setupMinioBucketAndVerify({
  projectDir = process.cwd(),
  dataDir,
  endpoint = "http://127.0.0.1:9000",
  consolePort = 9001,
  region = "us-east-1",
  accessKeyId = "minioadmin",
  secretAccessKey = "minioadmin",
  bucket = "patchwork",
}) {
  await ensureMinioServerRunning({
    projectDir,
    dataDir,
    endpoint,
    consolePort,
    accessKeyId,
    secretAccessKey,
  });

  const s3 = createS3Client({ endpoint, region, accessKeyId, secretAccessKey });

  // Create bucket if missing
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }

  // Verify read/write with a test object
  const probeKey = `.patchwork-setup-probe-${Date.now()}.txt`;
  const probeContent = `patchwork-probe-${Date.now()}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: probeKey,
      Body: Buffer.from(probeContent, "utf8"),
      ContentType: "text/plain",
    })
  );

  const getRes = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: probeKey,
    })
  );
  const bodyStr = getRes.Body ? await getRes.Body.transformToString() : "";
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: probeKey,
    })
  );

  if (bodyStr !== probeContent) {
    throw new Error(
      `MinIO read/write verification mismatch on bucket '${bucket}'`
    );
  }

  return {
    endpoint,
    bucket,
    dataDir: dataDir || path.join(projectDir, ".minio-data"),
    verifiedReadWrite: true,
    systemdStatus: (() => {
      const sys = getSystemInfo();
      return sys.isLinux
        ? {
            supported: true,
            message:
              "Linux detected: systemd unit available at deploy/minio.service",
          }
        : {
            supported: false,
            message: `Skipped systemd minio.service installation (detected ${sys.platform}, Linux-only step).`,
          };
    })(),
  };
}

export async function verifyPresignedUrlsWork({
  publicUrl,
  region = "us-east-1",
  accessKeyId,
  secretAccessKey,
  bucket = "patchwork",
}) {
  const publicClient = createS3Client({
    endpoint: publicUrl,
    region,
    accessKeyId,
    secretAccessKey,
  });
  const key = `.patchwork-presign-probe-${Date.now()}.txt`;
  const payload = `presign-${Date.now()}`;

  const putUrl = await getSignedUrl(
    publicClient,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: "text/plain",
    }),
    { expiresIn: 120 }
  );
  const getUrl = await getSignedUrl(
    publicClient,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: 120 }
  );

  // If publicUrl is locally reachable (localhost/127.0.0.1/LAN IP), execute live PUT + GET
  const parsed = new URL(publicUrl);
  if (parsed.protocol === "http:") {
    const putRes = await fetch(putUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: payload,
      signal: AbortSignal.timeout(5000),
    });
    if (!putRes.ok) {
      throw new Error(`Presigned PUT failed (${putRes.status}) against ${publicUrl}`);
    }
    const getRes = await fetch(getUrl, { signal: AbortSignal.timeout(5000) });
    if (!getRes.ok || (await getRes.text()) !== payload) {
      throw new Error(`Presigned GET failed against ${publicUrl}`);
    }
    await publicClient.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  return { putUrl, getUrl, publicUrl };
}

export async function emptyAndRemoveMinioBucket({
  endpoint = "http://127.0.0.1:9000",
  region = "us-east-1",
  accessKeyId = "minioadmin",
  secretAccessKey = "minioadmin",
  bucket,
}) {
  if (!bucket) return;
  const s3 = createS3Client({ endpoint, region, accessKeyId, secretAccessKey });
  try {
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    for (const obj of listed.Contents || []) {
      if (obj.Key) {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
      }
    }
    await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
  } catch {
    // Ignore if bucket already missing
  }
}

