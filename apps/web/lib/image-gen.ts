import OpenAI from "openai";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { aiConfigurations } from "@dishes/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { uploadFile, isStorageAvailable } from "@/lib/storage";
import { makeThumbnail } from "@/lib/thumbnail";
import { createLogger } from "@/lib/logger";
import { getStyleSuffix } from "@/lib/image-styles";

const log = createLogger("image-gen");

export async function generateRecipeImageCore(
  householdId: string,
  title: string,
  description: string | null,
  style?: string | null,
  instructions?: string | null
): Promise<{ url?: string; thumbnailUrl?: string; error?: string }> {
  if (!isStorageAvailable()) {
    return {
      error:
        "Image storage is not configured — add S3 settings to enable AI image generation.",
    };
  }

  const [config] = await db
    .select({
      encryptedApiKey: aiConfigurations.encryptedApiKey,
      imageModel: aiConfigurations.imageModel,
      imageStyle: aiConfigurations.imageStyle,
    })
    .from(aiConfigurations)
    .where(eq(aiConfigurations.householdId, householdId))
    .limit(1);

  if (!config)
    return { error: "AI not configured. Add your API key in Settings → AI." };

  const apiKey = decrypt(config.encryptedApiKey);
  // Force native (undici) fetch — see note in app/actions/ai.ts; node-fetch
  // throws "Premature close" on Node 22.23+.
  const client = new OpenAI({ apiKey, fetch: globalThis.fetch });
  const imageModel = config.imageModel ?? "dall-e-3";

  const styleSuffix = getStyleSuffix(style ?? config.imageStyle);
  const extra = instructions?.trim()
    ? ` Important — follow these specific instructions about the shot: ${instructions.trim()}`
    : "";
  const prompt = `Professional food photography of "${title}". ${
    description ? description + " " : ""
  }${styleSuffix}${extra}`;

  log.info(`Generating image with model=${imageModel} for "${title}"`);

  const response = await client.images.generate({
    model: imageModel,
    prompt,
    n: 1,
    size: "1024x1024",
  });

  const imageData = response.data?.[0];
  let buffer: Buffer;

  if (imageData?.b64_json) {
    buffer = Buffer.from(imageData.b64_json, "base64");
  } else if (imageData?.url) {
    log.debug("Model returned URL — fetching to upload");
    const fetched = await fetch(imageData.url);
    if (!fetched.ok)
      throw new Error(`Failed to fetch generated image: ${fetched.status}`);
    buffer = Buffer.from(await fetched.arrayBuffer());
  } else {
    log.error("Image generation response had no usable data:", JSON.stringify(response.data));
    throw new Error("No image data returned from AI.");
  }

  const id = randomUUID();
  const [url, thumbnailBuffer] = await Promise.all([
    uploadFile(`recipes/${householdId}/${id}.png`, buffer, "image/png"),
    makeThumbnail(buffer),
  ]);
  const thumbnailUrl = await uploadFile(`recipes/${householdId}/${id}_thumb.jpg`, thumbnailBuffer, "image/jpeg");
  log.info(`Image uploaded: ${url}`);

  return { url, thumbnailUrl };
}
