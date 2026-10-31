import { NextRequest, NextResponse, after } from "next/server";
import { ZodError } from "zod";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { recipeWriteSchema, toWriteInput } from "@/lib/api/schemas/recipe";
import { createRecipe, getRecipe, RecipeValidationError } from "@/lib/services/recipes";
import { recipeDetailJson } from "@/lib/integration-recipes";
import { estimateRecipeNutrition } from "@/lib/ai/recipe-nutrition";
import { createLogger } from "@/lib/logger";

const log = createLogger("integrations-recipes");

// The recipe body /api/v1/recipes takes, less the photo: an image URL from
// elsewhere would be hotlinked rather than stored, so photos stay in the app.
const createSchema = recipeWriteSchema.omit({ imageUrl: true, thumbnailUrl: true });

// Add a recipe to the household library: 201 with the recipe as getRecipe
// returns it. Filed as the member the token acts as, if any. Sent without
// nutrition, the household's AI estimates it after the response (no key, no
// estimate), and it shows in getRecipe a few seconds later.
export const POST = withIntegrationAuth("write:recipes", async (req: NextRequest, ctx) => {
  let body: ReturnType<typeof createSchema.parse>;
  try {
    body = createSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid recipe", issues: err.issues }, { status: 400 });
    }
    if (err instanceof SyntaxError) return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
    throw err;
  }

  const bad = body.steps.flatMap((s) => s.ingredientIndexes).find((i) => i >= body.ingredients.length);
  if (bad !== undefined) {
    return NextResponse.json({ error: `ingredientIndexes ${bad} is past the end of ingredients` }, { status: 400 });
  }

  let recipeId: string;
  try {
    ({ recipeId } = await createRecipe(
      { householdId: ctx.householdId, memberId: ctx.memberId },
      { ...toWriteInput({ ...body, imageUrl: null, thumbnailUrl: null }), isAiGenerated: false }
    ));
  } catch (err) {
    if (err instanceof RecipeValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  if (!body.nutrition && body.ingredients.length) {
    after(async () => {
      const { error } = await estimateRecipeNutrition(ctx.householdId, recipeId);
      if (error) log.info(`no nutrition for ${recipeId}: ${error}`);
    });
  }

  const recipe = await getRecipe({ householdId: ctx.householdId }, recipeId);
  return NextResponse.json({ recipe: recipeDetailJson(recipe) }, { status: 201 });
});
