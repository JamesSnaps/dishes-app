/**
 * Image upload — shared by the web app's multipart route (`app/api/upload`) and
 * the client API (`app/api/v1/upload`).
 *
 * Takes raw bytes rather than a File so both a browser form post and a native
 * client's binary body reach the same code.
 */

import { randomUUID } from "crypto";
import { uploadFile, isStorageAvailable } from "@/lib/storage";
import { makeThumbnail } from "@/lib/thumbnail";
import type { HouseholdContext } from "@/lib/session";

export class UploadUnavailableError extends Error {
  constructor() {
    super("Image storage is not configured on this server.");
    this.name = "UploadUnavailableError";
  }
}

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const MAX_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

export type UploadResult = { url: string; thumbnailUrl: string | null };

export async function uploadRecipeImage(
  ctx: HouseholdContext,
  raw: Buffer,
  contentType: string
): Promise<UploadResult> {
  if (!isStorageAvailable()) throw new UploadUnavailableError();

  if (!ALLOWED_TYPES.includes(contentType)) {
    throw new UploadValidationError(
      "Only JPEG, PNG, WebP, and GIF images are allowed."
    );
  }
  if (raw.byteLength === 0) throw new UploadValidationError("No file provided.");
  if (raw.byteLength > MAX_SIZE_BYTES) {
    throw new UploadValidationError("File exceeds the 8 MB limit.");
  }

  const id = randomUUID();
  const ext = contentType.split("/")[1]!.replace("jpeg", "jpg");

  // GIFs are not resizable with sharp — skip thumbnail generation for them.
  const isResizable = contentType !== "image/gif";

  const [url, thumbnailBuffer] = await Promise.all([
    uploadFile(`recipes/${ctx.householdId}/${id}.${ext}`, raw, contentType),
    isResizable ? makeThumbnail(raw) : Promise.resolve(null),
  ]);

  let thumbnailUrl: string | null = null;
  if (thumbnailBuffer) {
    thumbnailUrl = await uploadFile(
      `recipes/${ctx.householdId}/${id}_thumb.jpg`,
      thumbnailBuffer,
      "image/jpeg"
    );
  }

  return { url, thumbnailUrl };
}
