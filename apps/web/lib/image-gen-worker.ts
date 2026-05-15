import { db } from "@/lib/db";
import { recipes, notifications } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getRedis } from "@/lib/redis";
import { generateRecipeImageCore } from "./image-gen";

async function updateJobStatus(
  jobId: string,
  status: string,
  extra?: Record<string, unknown>
) {
  const redis = getRedis();
  if (!redis) return;
  try {
    const key = `image-gen-job:${jobId}`;
    const existing = await redis.get(key);
    const data = existing ? JSON.parse(existing) : {};
    await redis.set(
      key,
      JSON.stringify({ ...data, status, ...extra }),
      "EX",
      3600
    );
  } catch (err) {
    console.error("[image-gen] Failed to update job status:", err);
  }
}

export async function generateImageBackground(
  jobId: string,
  recipeId: string,
  householdId: string,
  notificationId: string
): Promise<void> {
  try {
    await updateJobStatus(jobId, "running");

    const [recipe] = await db
      .select({ title: recipes.title, description: recipes.description })
      .from(recipes)
      .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
      .limit(1);

    if (!recipe) {
      await updateJobStatus(jobId, "failed", { error: "Recipe not found." });
      await db
        .update(notifications)
        .set({ type: "image_failed", title: "Image generation failed", body: "Recipe not found." })
        .where(eq(notifications.id, notificationId));
      return;
    }

    const { url, error } = await generateRecipeImageCore(
      householdId,
      recipe.title,
      recipe.description
    );

    if (error || !url) {
      const msg = error ?? "Image generation failed.";
      await updateJobStatus(jobId, "failed", { error: msg });
      await db
        .update(notifications)
        .set({ type: "image_failed", title: "Image generation failed", body: msg })
        .where(eq(notifications.id, notificationId));
      return;
    }

    await db
      .update(recipes)
      .set({ imageUrl: url })
      .where(eq(recipes.id, recipeId));

    // Update the "generating" notification to "ready" in place
    await db
      .update(notifications)
      .set({
        type: "image_generated",
        title: "Image ready",
        body: `Photo generated for "${recipe.title}"`,
        readAt: null,
      })
      .where(eq(notifications.id, notificationId));

    revalidatePath(`/recipes/${recipeId}`);
    revalidatePath("/recipes");

    await updateJobStatus(jobId, "done", { imageUrl: url });
    console.log(`[image-gen] Job ${jobId} completed for recipe ${recipeId}`);
  } catch (err) {
    console.error(`[image-gen] Job ${jobId} failed:`, err);
    const message = err instanceof Error ? err.message : String(err);
    await updateJobStatus(jobId, "failed", { error: message });
  }
}
