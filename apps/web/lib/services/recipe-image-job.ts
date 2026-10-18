import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { notifications, recipes } from "@dishes/db/schema";
import { db } from "@/lib/db";
import { getRedis } from "@/lib/redis";
import { generateImageBackground } from "@/lib/image-gen-worker";
import { createLogger } from "@/lib/logger";

const log = createLogger("image-gen-job");

/**
 * Starts a recipe photo in the background: a "generating" notification now,
 * the image (and an "Image ready" notification) in 15–30 seconds. Used by the
 * web's Generate image button and the iOS app's photo tool. Answers null when
 * the recipe isn't in the household.
 */
export async function startRecipeImageJob(
  householdId: string,
  recipeId: string,
  style: string | null,
  instructions: string | null
): Promise<{ jobId: string } | null> {
  const [recipe] = await db
    .select({ title: recipes.title })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);

  if (!recipe) {
    return null;
  }

  // Create a "generating" notification immediately so the bell lights up
  const [notif] = await db
    .insert(notifications)
    .values({
      householdId,
      type: "image_generating",
      title: "Generating image…",
      body: `Creating a photo for "${recipe.title}" — this usually takes 15–30 seconds.`,
      recipeId,
    })
    .returning({ id: notifications.id });

  const jobId = randomUUID();
  const redis = getRedis();

  if (redis) {
    await redis.set(
      `image-gen-job:${jobId}`,
      JSON.stringify({
        status: "pending",
        recipeId,
        householdId,
        style,
        instructions,
        startedAt: Date.now(),
      }),
      "EX",
      3600
    );
  }

  // Fire and forget — returns before the image is ready
  generateImageBackground(jobId, recipeId, householdId, notif.id, style, instructions).catch((err) => {
    log.error(`Background job ${jobId} threw:`, err);
  });

  log.info(`Started background image job ${jobId} for recipe ${recipeId}`);
  return { jobId };
}
