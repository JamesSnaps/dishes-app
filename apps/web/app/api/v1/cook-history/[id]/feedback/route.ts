import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { cookHistory, recipes } from "@dishes/db/schema";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { apiError, withApiErrors } from "@/lib/api/respond";
import { reviewDishPhoto } from "@/app/actions/ai";

/**
 * POST — the AI's take on how the cook's photo looks, as the web shows after
 * "Save & finish": `{ feedback }`. 404 without a photo; 422 when AI isn't set up.
 */
export const POST = withApiErrors(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession();
    const [cook] = await db
      .select({ photoUrl: cookHistory.photoUrl, title: recipes.title })
      .from(cookHistory)
      .innerJoin(recipes, eq(cookHistory.recipeId, recipes.id))
      .where(and(eq(cookHistory.id, (await params).id), eq(recipes.householdId, session.householdId)))
      .limit(1);
    if (!cook?.photoUrl) return apiError("not_found", "This cook has no photo", 404);
    const result = await reviewDishPhoto(cook.title, cook.photoUrl);
    if (result.error || !result.feedback) return apiError("invalid_request", result.error ?? "No feedback came back.", 422);
    return NextResponse.json({ feedback: result.feedback });
  }
);
