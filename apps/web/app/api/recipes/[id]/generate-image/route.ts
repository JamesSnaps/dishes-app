import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getRedis } from "@/lib/redis";
import { generateImageBackground } from "@/lib/image-gen-worker";
import { db } from "@/lib/db";
import { recipes, notifications } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("image-gen-route");

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: recipeId } = await params;
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);

    const [recipe] = await db
      .select({ title: recipes.title })
      .from(recipes)
      .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
      .limit(1);

    if (!recipe) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
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
          startedAt: Date.now(),
        }),
        "EX",
        3600
      );
    }

    // Fire and forget — returns before the image is ready
    generateImageBackground(jobId, recipeId, householdId, notif.id).catch((err) => {
      log.error(`Background job ${jobId} threw:`, err);
    });

    log.info(`Started background image job ${jobId} for recipe ${recipeId}`);
    return NextResponse.json({ jobId, status: "pending" });
  } catch (err) {
    log.error("Failed to start job:", err);
    return NextResponse.json(
      { error: "Failed to start image generation" },
      { status: 500 }
    );
  }
}
