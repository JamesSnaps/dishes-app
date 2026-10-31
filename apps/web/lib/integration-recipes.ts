import { after } from "next/server";
import type { z } from "zod";
import { recipeWriteSchema, toWriteInput } from "@/lib/api/schemas/recipe";
import { createRecipe, getRecipe, listRecipes } from "@/lib/services/recipes";
import { estimateRecipeNutrition } from "@/lib/ai/recipe-nutrition";
import { createLogger } from "@/lib/logger";

const log = createLogger("integrations-recipes");

type Recipe = Awaited<ReturnType<typeof getRecipe>>;

/**
 * A recipe as an integration sends it (POST /api/integrations/recipes, the MCP
 * server's createRecipe): the /api/v1 body less the photo, since an image URL
 * from elsewhere would be hotlinked rather than stored.
 */
export const integrationRecipeSchema = recipeWriteSchema.omit({ imageUrl: true, thumbnailUrl: true });
export type IntegrationRecipe = z.infer<typeof integrationRecipeSchema>;

/** A recipe the caller can fix: say what's wrong (400, or a tool error). */
export class RecipeInputError extends Error {}

function num(value: string | null): number | null {
  return value == null ? null : Number(value);
}

/** A recipe as the integrations API returns it (getRecipe, createRecipe). */
export function recipeDetailJson(recipe: Recipe) {
  const hasNutrition = recipe.calories != null || recipe.proteinG != null;
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    cuisine: recipe.cuisine,
    difficulty: recipe.difficulty,
    servings: recipe.servings == null ? null : String(Number(recipe.servings)),
    servingsUnit: recipe.servingsUnit,
    prepTimeMinutes: recipe.prepTimeMinutes,
    cookTimeMinutes: recipe.cookTimeMinutes,
    calories: recipe.calories,
    mealTypes: recipe.mealTypes ?? [],
    tags: recipe.tags,
    notes: recipe.notes,
    sourceUrl: recipe.sourceUrl,
    nutrition: hasNutrition
      ? {
          calories: recipe.calories,
          proteinG: num(recipe.proteinG),
          carbsG: num(recipe.carbsG),
          fatG: num(recipe.fatG),
          saturatedFatG: num(recipe.saturatedFatG),
          fiberG: num(recipe.fiberG),
          sugarG: num(recipe.sugarG),
          sodiumMg: num(recipe.sodiumMg),
        }
      : null,
    ingredients: recipe.ingredients.map((i) => ({
      id: i.id,
      ingredientName: i.ingredientName,
      amount: i.amount,
      unit: i.unit,
      preparation: i.preparation,
      isOptional: i.isOptional,
      groupLabel: i.groupLabel,
    })),
    steps: recipe.steps.map((s, index) => ({
      step: index + 1,
      instruction: s.instruction,
      durationMinutes: s.durationMinutes,
      timerLabel: s.timerLabel,
      groupLabel: s.groupLabel,
      ingredientIds: s.ingredientIds ?? [],
    })),
  };
}

/**
 * Add a recipe to the household library, filed as the member the token acts
 * as (if any). Sent without nutrition, the household's AI estimates it after
 * the response — no key, no estimate. Returns it as getRecipe does.
 */
export async function addRecipe(actor: { householdId: string; memberId: string | null }, body: IntegrationRecipe) {
  const bad = body.steps.flatMap((s) => s.ingredientIndexes).find((i) => i >= body.ingredients.length);
  if (bad !== undefined) {
    throw new RecipeInputError(`ingredientIndexes ${bad} is past the end of ingredients (${body.ingredients.length})`);
  }

  const { recipeId } = await createRecipe(actor, {
    ...toWriteInput({ ...body, imageUrl: null, thumbnailUrl: null }),
    isAiGenerated: false,
  });

  if (!body.nutrition && body.ingredients.length) {
    after(async () => {
      const { error } = await estimateRecipeNutrition(actor.householdId, recipeId);
      if (error) log.info(`no nutrition for ${recipeId}: ${error}`);
    });
  }

  return recipeDetailJson(await getRecipe({ householdId: actor.householdId }, recipeId));
}

/**
 * Recipes in the library whose title, tags or ingredients mention `q` (all of
 * them without one), most recently changed first, as short summaries — enough
 * to pick one for getRecipe, or to see a recipe is already there.
 */
export async function searchRecipes(householdId: string, q: string | undefined, limit = 20) {
  const rows = await listRecipes({ householdId }, { q, limit: Math.min(Math.max(limit, 1), 100) });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    cuisine: r.cuisine,
    difficulty: r.difficulty,
    prepTimeMinutes: r.prepTimeMinutes,
    cookTimeMinutes: r.cookTimeMinutes,
    calories: r.calories,
    mealTypes: r.mealTypes ?? [],
    isFavourite: r.isFavourite,
  }));
}
