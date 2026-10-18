import { NextRequest, NextResponse } from "next/server";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { createLogger } from "@/lib/logger";
import { startRecipeImageJob } from "@/lib/services/recipe-image-job";

const log = createLogger("image-gen-route");

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: recipeId } = await params;
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);

    const body = await req.json().catch(() => ({})) as {
      style?: string;
      instructions?: string;
    };
    const style = typeof body.style === "string" ? body.style : null;
    const instructions =
      typeof body.instructions === "string"
        ? body.instructions.trim().slice(0, 500) || null
        : null;

    const job = await startRecipeImageJob(householdId, recipeId, style, instructions);
    if (!job) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }
    return NextResponse.json({ jobId: job.jobId, status: "pending" });
  } catch (err) {
    log.error("Failed to start job:", err);
    return NextResponse.json(
      { error: "Failed to start image generation" },
      { status: 500 }
    );
  }
}
