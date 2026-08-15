"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import * as recipeService from "@/lib/services/recipes";
import type {
  IngredientInput,
  RecipeFields,
  RecipeWriteInput,
  StepInput,
} from "@/lib/services/recipes";
import { suggestCollectionForRecipe, type GeneratedRecipe } from "./ai";

/**
 * This module is the web transport for recipe writes: parse FormData, call the
 * service, then revalidate and navigate. All domain logic lives in
 * `lib/services/recipes.ts` so the REST routes under `app/api/v1/recipes`
 * behave identically.
 */

// --- Form parsing -----------------------------------------------------------

function parseJSON<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function extractRecipeFields(formData: FormData): RecipeFields {
  const str = (key: string) => (formData.get(key) as string)?.trim() || null;

  return {
    title: (formData.get("title") as string)?.trim() ?? "",
    description: str("description"),
    cuisine: str("cuisine"),
    prepTimeMinutes: parseInt(formData.get("prepTimeMinutes") as string) || null,
    cookTimeMinutes: parseInt(formData.get("cookTimeMinutes") as string) || null,
    servings: str("servings"),
    servingsUnit: str("servingsUnit") ?? "servings",
    difficulty: (formData.get("difficulty") as "easy" | "medium" | "hard") || null,
    mealTypes: recipeService.sanitizeMealTypes(
      parseJSON<string[]>(formData.get("mealTypes") as string, [])
    ),
    sourceUrl: str("sourceUrl"),
    notes: str("notes"),
    imageUrl: str("imageUrl"),
    thumbnailUrl: str("thumbnailUrl"),
    ...recipeService.buildNutrition(
      {
        calories: str("calories"),
        proteinG: str("proteinG"),
        carbsG: str("carbsG"),
        fatG: str("fatG"),
        fiberG: str("fiberG"),
        sugarG: str("sugarG"),
        sodiumMg: str("sodiumMg"),
      },
      "manual"
    ),
  };
}

function extractWriteInput(formData: FormData): RecipeWriteInput {
  return {
    fields: extractRecipeFields(formData),
    ingredients: parseJSON<IngredientInput[]>(formData.get("ingredients") as string, []),
    steps: parseJSON<StepInput[]>(formData.get("steps") as string, []),
    tags: ((formData.get("tags") as string) ?? "").split(",").map((t) => t.trim()),
    collectionId: (formData.get("collectionId") as string) ?? null,
  };
}

/** Map an AI-generated recipe onto the service's write input. */
function generatedToWriteInput(
  recipe: GeneratedRecipe,
  collectionId?: string | null
): RecipeWriteInput {
  return {
    fields: {
      title: recipe.title,
      description: recipe.description || null,
      cuisine: recipe.cuisine || null,
      prepTimeMinutes: recipe.prepTimeMinutes,
      cookTimeMinutes: recipe.cookTimeMinutes,
      servings: recipe.servings || null,
      servingsUnit: recipe.servingsUnit || "servings",
      difficulty: recipe.difficulty || null,
      mealTypes: recipeService.sanitizeMealTypes(recipe.mealTypes),
      sourceUrl: null,
      notes: recipe.notes,
      imageUrl: null,
      thumbnailUrl: null,
      ...recipeService.buildNutrition(recipe.nutrition, "ai"),
    },
    ingredients: recipe.ingredients.map((ing) => ({
      ingredientName: ing.ingredientName,
      amount: ing.amount,
      unit: ing.unit,
      preparation: ing.preparation,
      isOptional: ing.isOptional,
      groupLabel: ing.groupLabel,
    })),
    steps: recipe.steps.map((s) => ({
      instruction: s.instruction,
      durationMinutes: s.durationMinutes,
      timerLabel: s.timerLabel,
      groupLabel: s.groupLabel,
    })),
    tags: recipe.tags,
    collectionId: collectionId ?? null,
    isAiGenerated: true,
  };
}

// --- Cache invalidation -----------------------------------------------------

function revalidateCollections(collectionId: string | null) {
  if (!collectionId) return;
  revalidatePath(`/collections/${collectionId}`);
  revalidatePath("/collections");
}

// --- Actions ----------------------------------------------------------------

export async function createRecipe(formData: FormData) {
  const session = await requireSession();

  const { recipeId, linkedCollectionId } = await recipeService.createRecipe(
    session,
    extractWriteInput(formData)
  );

  revalidateCollections(linkedCollectionId);
  revalidatePath("/recipes");
  redirect(`/recipes/${recipeId}`);
}

export async function updateRecipe(recipeId: string, formData: FormData) {
  const session = await requireSession();

  await recipeService.updateRecipe(session, recipeId, extractWriteInput(formData));

  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath("/recipes");
  redirect(`/recipes/${recipeId}`);
}

export async function deleteRecipe(recipeId: string) {
  const session = await requireSession();

  await recipeService.deleteRecipe(session, recipeId);

  revalidatePath("/recipes");
  redirect("/recipes");
}

export async function saveGeneratedRecipe(
  recipe: GeneratedRecipe
): Promise<{ recipeId?: string; collectionName?: string; error?: string }> {
  try {
    const session = await requireSession();

    // File it into an existing collection when the AI is confident it belongs.
    const suggestion = await suggestCollectionForRecipe({
      title: recipe.title,
      description: recipe.description,
      cuisine: recipe.cuisine,
      tags: recipe.tags,
      mealTypes: recipe.mealTypes,
    });

    const { recipeId, linkedCollectionId } = await recipeService.createRecipe(
      session,
      generatedToWriteInput(recipe, suggestion.collectionId)
    );

    revalidateCollections(linkedCollectionId);
    revalidatePath("/recipes");

    return {
      recipeId,
      collectionName: linkedCollectionId ? suggestion.collectionName : undefined,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to save recipe." };
  }
}

export async function saveRecipeAsCopy(
  originalRecipeId: string,
  tweaked: GeneratedRecipe
): Promise<{ recipeId?: string; error?: string }> {
  try {
    const session = await requireSession();

    // Confirm the original is ours before spawning a copy from it.
    await recipeService.getRecipe(session, originalRecipeId);

    const { recipeId } = await recipeService.createRecipe(
      session,
      generatedToWriteInput(tweaked)
    );

    revalidatePath("/recipes");
    return { recipeId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to save recipe." };
  }
}

export async function applyTweakToRecipe(
  recipeId: string,
  tweaked: GeneratedRecipe
): Promise<{ error?: string }> {
  try {
    const session = await requireSession();

    await recipeService.replaceRecipeBody(
      session,
      recipeId,
      generatedToWriteInput(tweaked)
    );

    revalidatePath(`/recipes/${recipeId}`);
    revalidatePath("/recipes");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update recipe." };
  }
}

export async function bulkAddTags(recipeIds: string[], tags: string[]): Promise<void> {
  const session = await requireSession();
  await recipeService.bulkAddTags(session, recipeIds, tags);
  revalidatePath("/recipes");
}

export async function bulkRemoveTags(recipeIds: string[], tags: string[]): Promise<void> {
  const session = await requireSession();
  await recipeService.bulkRemoveTags(session, recipeIds, tags);
  revalidatePath("/recipes");
}

export async function toggleFavourite(recipeId: string) {
  const session = await requireSession();

  await recipeService.toggleFavourite(session, recipeId);

  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath("/recipes");
}

export async function updateRecipeCookTime(
  recipeId: string,
  cookTimeMinutes: number
): Promise<void> {
  const session = await requireSession();

  await recipeService.updateRecipeCookTime(session, recipeId, cookTimeMinutes);

  revalidatePath(`/recipes/${recipeId}`);
}
