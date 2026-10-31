/**
 * Per-serving nutrition for a saved recipe, estimated by the household's AI.
 * Not a "use server" module, so it can take a household id: the recipe page's
 * "Estimate nutrition" (actions/ai.ts) and the integrations API both use it.
 */

import type OpenAI from "openai";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { recipeIngredients, recipes } from "@dishes/db/schema";
import { maxTokensParam, type RecipeNutrition } from "@/lib/ai/recipe-generation";
import { aiClientFor } from "@/lib/services/outside-meals";

/** What an estimate needs from the household's AI settings. */
export type NutritionAi = { client: OpenAI; model: string; measurementSystem: string };

export type NutritionSubject = {
  title: string;
  servings: string | null;
  servingsUnit: string | null;
  ingredients: { ingredientName: string; amount: string | null; unit: string | null }[];
};

/** One AI call: per-serving nutrition for a recipe, or null if nothing usable came back. */
export async function estimateNutritionFor(
  ai: NutritionAi,
  recipe: NutritionSubject
): Promise<RecipeNutrition | null> {
  const ingredientList = recipe.ingredients
    .map((r) => `- ${[r.amount, r.unit, r.ingredientName].filter(Boolean).join(" ")}`)
    .join("\n");
  const servings = recipe.servings ? `${recipe.servings} ${recipe.servingsUnit ?? "servings"}` : "unknown (assume 4 servings)";

  const completion = await ai.client.chat.completions.create({
    model: ai.model,
    response_format: { type: "json_object" },
    ...maxTokensParam(ai.model, 400),
    messages: [
      {
        role: "system",
        content: `You are a nutrition estimator. Given a recipe's ingredients and the number of servings, return a best-effort PER-SERVING nutrition estimate as JSON matching exactly:
{
  "calories": number (kcal per serving),
  "proteinG": number, "carbsG": number, "fatG": number,
  "saturatedFatG": number,
  "fiberG": number, "sugarG": number, "sodiumMg": number
}
Base your estimate on standard food composition data. Measurement system: ${ai.measurementSystem}. Return realistic numbers, never null.`,
      },
      {
        role: "user",
        content: `Recipe: ${recipe.title}\nServings: ${servings}\nIngredients:\n${ingredientList}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(raw) as Partial<RecipeNutrition>;

  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const nutrition: RecipeNutrition = {
    calories: num(parsed.calories),
    proteinG: num(parsed.proteinG),
    carbsG: num(parsed.carbsG),
    fatG: num(parsed.fatG),
    saturatedFatG: num(parsed.saturatedFatG),
    fiberG: num(parsed.fiberG),
    sugarG: num(parsed.sugarG),
    sodiumMg: num(parsed.sodiumMg),
  };

  return Object.values(nutrition).some((v) => v != null) ? nutrition : null;
}

const decimalOrNull = (v: number | null) => (v == null ? null : String(v));

/** Column values for a full AI nutrition estimate. */
export function nutritionColumns(n: RecipeNutrition) {
  return {
    calories: n.calories == null ? null : Math.round(n.calories),
    proteinG: decimalOrNull(n.proteinG),
    carbsG: decimalOrNull(n.carbsG),
    fatG: decimalOrNull(n.fatG),
    saturatedFatG: decimalOrNull(n.saturatedFatG),
    fiberG: decimalOrNull(n.fiberG),
    sugarG: decimalOrNull(n.sugarG),
    sodiumMg: decimalOrNull(n.sodiumMg),
    nutritionSource: "ai" as const,
  };
}

/**
 * Estimate and save a recipe's nutrition (nutritionSource "ai"). Returns why
 * not when it can't: no AI key, no ingredients, or nothing usable came back.
 */
export async function estimateRecipeNutrition(householdId: string, recipeId: string): Promise<{ error?: string }> {
  const [recipe] = await db
    .select({ title: recipes.title, servings: recipes.servings, servingsUnit: recipes.servingsUnit })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);
  if (!recipe) return { error: "Recipe not found." };

  const ingredients = await db
    .select({ ingredientName: recipeIngredients.ingredientName, amount: recipeIngredients.amount, unit: recipeIngredients.unit })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId));
  if (!ingredients.length) return { error: "No ingredients to estimate from." };

  const ai = await aiClientFor(householdId);
  if (!ai) return { error: "AI not configured." };
  const nutrition = await estimateNutritionFor(ai, { ...recipe, ingredients });
  if (!nutrition) return { error: "Nothing usable came back." };

  await db
    .update(recipes)
    .set(nutritionColumns(nutrition))
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)));
  return {};
}
