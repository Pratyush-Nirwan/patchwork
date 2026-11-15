import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import { binPath } from "./lib/platform.mjs";

dotenv.config({ path: ".env.test" });

const endpoint = process.env.S3_ENDPOINT || "http://127.0.0.1:9000";
const accessKeyId = process.env.S3_ACCESS_KEY || "minioadmin";
const secretAccessKey = process.env.S3_SECRET_KEY || "minioadmin";
const bucket = process.env.S3_BUCKET || "patchwork-test";

async function isMinioRunning() {
  try {
    const res = await fetch(`${endpoint}/minio/health/live`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureBucket(bucketName) {
  const s3 = new S3Client({
    endpoint,
    region: process.env.S3_REGION || "us-east-1",
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucketName }));
  }
}

async function main() {
  const minioInfo = binPath("minio");
  const minioBin = minioInfo.path;

  if (!minioInfo.exists || !minioInfo.executable) {
    console.error(minioInfo.hint || `Missing MinIO binary at ${minioBin}`);
    process.exit(1);
  }

  const dataDir = path.join(process.cwd(), ".minio-data");
  fs.mkdirSync(dataDir, { recursive: true });

  if (!(await isMinioRunning())) {
    console.log("Starting MinIO server...");
    const child = spawn(
      minioBin,
      ["server", dataDir, "--address", "127.0.0.1:9000", "--console-address", "127.0.0.1:9001"],
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

    let ready = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await isMinioRunning()) {
        ready = true;
        break;
      }
    }
    if (!ready) {
      console.error("MinIO failed to become ready on http://127.0.0.1:9000");
      process.exit(1);
    }
  }

  await ensureBucket(bucket);
  await ensureBucket("patchwork");
  console.log(`MinIO ready at ${endpoint} with bucket '${bucket}'.`);
}

main().catch((err) => {
  console.error("dev-minio error:", err);
  process.exit(1);
});

