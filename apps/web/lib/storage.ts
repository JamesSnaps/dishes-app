import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
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
 * Server-side copy of an existing object to a new key. Used when a recipe is
 * imported into another household: the copy gets its own object under that
 * household's prefix, so deleting the original leaves the import intact.
 */
export async function copyFile(sourceKey: string, destKey: string): Promise<string> {
  const client = getClient();
  await client.send(
    new CopyObjectCommand({
      Bucket: env.S3_BUCKET,
      CopySource: `/${env.S3_BUCKET}/${sourceKey}`,
      Key: destKey,
    })
  );

  const base = env.S3_PUBLIC_URL ?? env.S3_ENDPOINT;
  return `${base}/${env.S3_BUCKET}/${destKey}`;
}

/**
 * Read a stored object back, for server-side work on a file uploaded earlier
 * (an AI reading a photo). Goes through the S3 client, so it works when the
 * public URL isn't reachable from the server.
 */
export async function downloadFile(key: string): Promise<Buffer> {
  const client = getClient();
  const res = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  if (!res.Body) throw new Error(`Empty object: ${key}`);
  return Buffer.from(await res.Body.transformToByteArray());
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
