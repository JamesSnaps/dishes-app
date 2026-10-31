import type { getRecipe } from "@/lib/services/recipes";

type Recipe = Awaited<ReturnType<typeof getRecipe>>;

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
