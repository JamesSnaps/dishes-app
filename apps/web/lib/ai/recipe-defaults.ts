import type { GeneratedRecipe } from "./recipe-generation";
import type { RecipeFormDefaults } from "@/app/(app)/recipes/_components/recipe-form";
import type { RecipeJobResult } from "./job-types";
import { withReferences } from "./references";

// A generated recipe as defaults for the new-recipe form, which reads them
// from sessionStorage "ai_draft" on /recipes/new.

export function recipeToDefaults(r: GeneratedRecipe): RecipeFormDefaults {
  return {
    title: r.title,
    description: r.description,
    cuisine: r.cuisine,
    difficulty: r.difficulty,
    prepTimeMinutes: r.prepTimeMinutes,
    cookTimeMinutes: r.cookTimeMinutes,
    servings: r.servings,
    servingsUnit: r.servingsUnit,
    mealTypes: r.mealTypes,
    mealRole: r.mealRole ?? null,
    tags: r.tags,
    ...withReferences(r.notes, r.references),
    ingredients: r.ingredients,
    steps: r.steps,
    calories: r.nutrition?.calories ?? null,
    proteinG: r.nutrition?.proteinG == null ? null : String(r.nutrition.proteinG),
    carbsG: r.nutrition?.carbsG == null ? null : String(r.nutrition.carbsG),
    fatG: r.nutrition?.fatG == null ? null : String(r.nutrition.fatG),
    saturatedFatG: r.nutrition?.saturatedFatG == null ? null : String(r.nutrition.saturatedFatG),
    fiberG: r.nutrition?.fiberG == null ? null : String(r.nutrition.fiberG),
    sugarG: r.nutrition?.sugarG == null ? null : String(r.nutrition.sugarG),
    sodiumMg: r.nutrition?.sodiumMg == null ? null : String(r.nutrition.sodiumMg),
  };
}

/** Form defaults for a finished recipe job, with its suggested collection. */
export function recipeJobToDefaults({ recipe, collection }: RecipeJobResult): RecipeFormDefaults {
  const defaults = recipeToDefaults(recipe);
  if (collection?.collectionId) {
    defaults.collectionId = collection.collectionId;
    defaults.collectionName = collection.collectionName;
  }
  return defaults;
}

/** Hands a draft to /recipes/new; the caller then navigates there. */
export function stashAiDraft(defaults: RecipeFormDefaults) {
  sessionStorage.setItem("ai_draft", JSON.stringify(defaults));
}
