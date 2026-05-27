import sharp from "sharp";

/** Resize to 400 px wide JPEG at 80% quality. Fast and safe for all input formats. */
export async function makeThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate() // auto-rotate from EXIF orientation, then strip the tag
    .resize(400, null, { withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}
