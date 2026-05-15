import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getRedis } from "@/lib/redis";
import { generateImageBackground } from "@/lib/image-gen-worker";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: recipeId } = await params;
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);

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
    generateImageBackground(jobId, recipeId, householdId).catch((err) => {
      console.error(`[image-gen] Background job ${jobId} threw:`, err);
    });

    return NextResponse.json({ jobId, status: "pending" });
  } catch (err) {
    console.error("[image-gen] Failed to start job:", err);
    return NextResponse.json(
      { error: "Failed to start image generation" },
      { status: 500 }
    );
  }
}
