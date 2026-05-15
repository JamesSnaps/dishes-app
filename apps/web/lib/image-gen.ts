import OpenAI from "openai";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { aiConfigurations } from "@dishes/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { uploadFile, isStorageAvailable } from "@/lib/storage";
import { createLogger } from "@/lib/logger";

const log = createLogger("image-gen");

export async function generateRecipeImageCore(
  householdId: string,
  title: string,
  description: string | null
): Promise<{ url?: string; error?: string }> {
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
    })
    .from(aiConfigurations)
    .where(eq(aiConfigurations.householdId, householdId))
    .limit(1);

  if (!config)
    return { error: "AI not configured. Add your API key in Settings → AI." };

  const apiKey = decrypt(config.encryptedApiKey);
  const client = new OpenAI({ apiKey });
  const imageModel = config.imageModel ?? "dall-e-3";

  const prompt = `Professional food photography of "${title}". ${
    description ? description + " " : ""
  }Beautifully plated, appetising, clean background, natural lighting. No text, no labels, no watermarks.`;

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

  const key = `recipes/${householdId}/${randomUUID()}.png`;
  const url = await uploadFile(key, buffer, "image/png");
  log.info(`Image uploaded: ${url}`);

  return { url };
}
