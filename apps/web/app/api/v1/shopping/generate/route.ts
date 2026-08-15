import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { generateSchema } from "@/lib/api/schemas/shopping";
import { generateFromRecipe } from "@/lib/services/shopping";

/** Pull a recipe's ingredients onto the active shopping list. */
export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();

  const { recipeId, servings, forceInclude } = generateSchema.parse(await req.json());
  const result = await generateFromRecipe(session, recipeId, servings, forceInclude);

  return NextResponse.json(result);
});
