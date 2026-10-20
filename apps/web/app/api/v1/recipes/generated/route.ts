import { NextRequest, after } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { saveGeneratedRecipe } from "@/app/actions/recipes";
import { estimateNutrition } from "@/app/actions/ai";
import { savedGeneratedRecipeSchema } from "@/lib/ai/recipe-generation";
import { createLogger } from "@/lib/logger";
import { fromAction } from "../../ai/respond";

const log = createLogger("recipes-generated");

/**
 * POST — save a recipe the iOS app wrote with the on-device model, the way
 * the concierge saves one. → 201 `{ recipeId, title, collectionName? }`; the
 * recipe syncs down. Sent without nutrition (the on-device model shouldn't
 * guess it), the household's AI estimates it once the reply has gone, and the
 * figures follow in the next sync. No key, no estimate.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  await requireSession();
  const { collectionId, ...recipe } = savedGeneratedRecipeSchema.parse(await req.json());
  const saved = await saveGeneratedRecipe(recipe, collectionId === undefined ? undefined : { collectionId });
  const recipeId = saved.recipeId;
  if (recipeId && !recipe.nutrition) {
    after(async () => {
      const { error } = await estimateNutrition(recipeId);
      if (error) log.info(`no nutrition for ${recipeId}: ${error}`);
    });
  }
  return fromAction({ ...saved, title: recipe.title }, 201);
});
