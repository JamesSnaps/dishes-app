import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { env } from "./env";

function s3Configured() {
  return !!(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY);
}

function getClient() {
  if (!s3Configured()) throw new Error("S3 not configured");
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: "us-east-1",
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY!,
      secretAccessKey: env.S3_SECRET_KEY!,
    },
    forcePathStyle: true,
  });
}

export function isStorageAvailable() {
  return s3Configured();
}

/**
 * Upload a file buffer to S3/MinIO. Returns the public URL.
 */
export async function uploadFile(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  const base = env.S3_PUBLIC_URL ?? env.S3_ENDPOINT;
  return `${base}/${env.S3_BUCKET}/${key}`;
}

/**
 * Delete a file from S3/MinIO by its key.
 */
export async function deleteFile(key: string): Promise<void> {
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

/**
 * Extract the S3 key from a full URL produced by uploadFile.
 * Returns null if the URL doesn't match our storage.
 */
export function keyFromUrl(url: string): string | null {
  const base = env.S3_PUBLIC_URL ?? env.S3_ENDPOINT;
  if (!base || !env.S3_BUCKET) return null;
  const prefix = `${base}/${env.S3_BUCKET}/`;
  return url.startsWith(prefix) ? url.slice(prefix.length) : null;
}
