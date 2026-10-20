import { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { saveGeneratedRecipe } from "@/app/actions/recipes";
import { savedGeneratedRecipeSchema } from "@/lib/ai/recipe-generation";
import { fromAction } from "../../ai/respond";

/**
 * POST — save a recipe the iOS app wrote with the on-device model, the way
 * the concierge saves one. → 201 `{ recipeId, title, collectionName? }`; the
 * recipe syncs down.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  await requireSession();
  const { collectionId, ...recipe } = savedGeneratedRecipeSchema.parse(await req.json());
  const saved = await saveGeneratedRecipe(recipe, collectionId === undefined ? undefined : { collectionId });
  return fromAction({ ...saved, title: recipe.title }, 201);
});
