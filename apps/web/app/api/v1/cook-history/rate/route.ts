import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { rateRecipeSchema } from "@/lib/api/schemas/cook-history";
import { rateRecipe } from "@/lib/services/cook-history";

/**
 * Rate a recipe without logging a cook. Recorded as a 'rating' entry: it counts
 * towards the average but not towards "cooked N times".
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();
  const { recipeId, rating, notes } = rateRecipeSchema.parse(await req.json());

  const { id } = await rateRecipe(session, recipeId, rating, notes);

  return NextResponse.json({ id }, { status: 201 });
});
