"use server";

import { db } from "@/lib/db";
import {
  recipes,
  recipeIngredients,
  recipeSteps,
  recipeTags,
} from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import type { GeneratedRecipe } from "./ai";

type IngredientInput = {
  ingredientName: string;
  amount: string;
  unit: string;
  preparation: string;
  isOptional: boolean;
  groupLabel: string;
};

type StepInput = {
  instruction: string;
  durationMinutes: string;
  timerLabel: string;
};

function parseJSON<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function extractRecipeFields(formData: FormData) {
  return {
    title: (formData.get("title") as string)?.trim() ?? "",
    description: (formData.get("description") as string)?.trim() || null,
    cuisine: (formData.get("cuisine") as string)?.trim() || null,
    prepTimeMinutes:
      parseInt(formData.get("prepTimeMinutes") as string) || null,
    cookTimeMinutes:
      parseInt(formData.get("cookTimeMinutes") as string) || null,
    servings: (formData.get("servings") as string)?.trim() || null,
    servingsUnit:
      (formData.get("servingsUnit") as string)?.trim() || "servings",
    difficulty:
      (formData.get("difficulty") as "easy" | "medium" | "hard") || null,
    sourceUrl: (formData.get("sourceUrl") as string)?.trim() || null,
    notes: (formData.get("notes") as string)?.trim() || null,
    imageUrl: (formData.get("imageUrl") as string)?.trim() || null,
    thumbnailUrl: (formData.get("thumbnailUrl") as string)?.trim() || null,
  };
}

async function insertIngredients(
  recipeId: string,
  ingredients: IngredientInput[]
) {
  if (!ingredients.length) return;
  await db.insert(recipeIngredients).values(
    ingredients.map((ing, i) => ({
      recipeId,
      position: i,
      ingredientName: ing.ingredientName,
      amount: ing.amount || null,
      unit: ing.unit || null,
      preparation: ing.preparation || null,
      isOptional: ing.isOptional,
      groupLabel: ing.groupLabel || null,
    }))
  );
}

async function insertSteps(recipeId: string, steps: StepInput[]) {
  if (!steps.length) return;
  await db.insert(recipeSteps).values(
    steps.map((step, i) => ({
      recipeId,
      position: i,
      instruction: step.instruction,
      durationMinutes: step.durationMinutes
        ? parseInt(step.durationMinutes)
        : null,
      timerLabel: step.timerLabel || null,
    }))
  );
}

async function insertTags(recipeId: string, tagsRaw: string) {
  const tags = tagsRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tags.length) return;
  await db.insert(recipeTags).values(tags.map((tag) => ({ recipeId, tag })));
}

export async function createRecipe(formData: FormData) {
  const user = await getAutheliaUser();
  const { householdId, memberId } = await requireHousehold(user);

  const fields = extractRecipeFields(formData);
  if (!fields.title) throw new Error("Title is required");

  const [recipe] = await db
    .insert(recipes)
    .values({ householdId, createdById: memberId, ...fields })
    .returning({ id: recipes.id });

  const recipeId = recipe!.id;

  const ingredients = parseJSON<IngredientInput[]>(
    formData.get("ingredients") as string,
    []
  );
  const steps = parseJSON<StepInput[]>(formData.get("steps") as string, []);

  await Promise.all([
    insertIngredients(recipeId, ingredients),
    insertSteps(recipeId, steps),
    insertTags(recipeId, (formData.get("tags") as string) ?? ""),
  ]);

  redirect(`/recipes/${recipeId}`);
}

export async function updateRecipe(recipeId: string, formData: FormData) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const existing = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);

  if (!existing.length) throw new Error("Recipe not found");

  const fields = extractRecipeFields(formData);
  if (!fields.title) throw new Error("Title is required");

  const ingredients = parseJSON<IngredientInput[]>(
    formData.get("ingredients") as string,
    []
  );
  const steps = parseJSON<StepInput[]>(formData.get("steps") as string, []);

  await db
    .update(recipes)
    .set(fields)
    .where(eq(recipes.id, recipeId));

  await db
    .delete(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId));
  await db.delete(recipeSteps).where(eq(recipeSteps.recipeId, recipeId));
  await db.delete(recipeTags).where(eq(recipeTags.recipeId, recipeId));

  await Promise.all([
    insertIngredients(recipeId, ingredients),
    insertSteps(recipeId, steps),
    insertTags(recipeId, (formData.get("tags") as string) ?? ""),
  ]);

  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath("/recipes");
  redirect(`/recipes/${recipeId}`);
}

export async function deleteRecipe(recipeId: string) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  await db
    .delete(recipes)
    .where(
      and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId))
    );

  revalidatePath("/recipes");
  redirect("/recipes");
}

export async function saveRecipeAsCopy(
  originalRecipeId: string,
  tweaked: GeneratedRecipe
): Promise<{ recipeId?: string; error?: string }> {
  try {
    const user = await getAutheliaUser();
    const { householdId, memberId } = await requireHousehold(user);

    const [original] = await db
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.id, originalRecipeId), eq(recipes.householdId, householdId)))
      .limit(1);
    if (!original) return { error: "Recipe not found." };

    const [newRecipe] = await db
      .insert(recipes)
      .values({
        householdId,
        createdById: memberId,
        title: tweaked.title,
        description: tweaked.description || null,
        cuisine: tweaked.cuisine || null,
        prepTimeMinutes: tweaked.prepTimeMinutes,
        cookTimeMinutes: tweaked.cookTimeMinutes,
        servings: tweaked.servings || null,
        servingsUnit: tweaked.servingsUnit || "servings",
        difficulty: tweaked.difficulty || null,
        notes: tweaked.notes,
        isAiGenerated: true,
      })
      .returning({ id: recipes.id });

    const newId = newRecipe!.id;

    await Promise.all([
      tweaked.ingredients.length
        ? db.insert(recipeIngredients).values(
            tweaked.ingredients.map((ing, i) => ({
              recipeId: newId,
              position: i,
              ingredientName: ing.ingredientName,
              amount: ing.amount || null,
              unit: ing.unit || null,
              preparation: ing.preparation || null,
              isOptional: ing.isOptional,
              groupLabel: ing.groupLabel || null,
            }))
          )
        : Promise.resolve(),
      tweaked.steps.length
        ? db.insert(recipeSteps).values(
            tweaked.steps.map((s, i) => ({
              recipeId: newId,
              position: i,
              instruction: s.instruction,
              durationMinutes: s.durationMinutes ? parseInt(s.durationMinutes) : null,
              timerLabel: s.timerLabel || null,
            }))
          )
        : Promise.resolve(),
      tweaked.tags.length
        ? db.insert(recipeTags).values(tweaked.tags.map((tag) => ({ recipeId: newId, tag })))
        : Promise.resolve(),
    ]);

    revalidatePath("/recipes");
    return { recipeId: newId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to save recipe." };
  }
}

export async function applyTweakToRecipe(
  recipeId: string,
  tweaked: GeneratedRecipe
): Promise<{ error?: string }> {
  try {
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);

    const [existing] = await db
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
      .limit(1);
    if (!existing) return { error: "Recipe not found." };

    await db
      .update(recipes)
      .set({
        title: tweaked.title,
        description: tweaked.description || null,
        cuisine: tweaked.cuisine || null,
        prepTimeMinutes: tweaked.prepTimeMinutes,
        cookTimeMinutes: tweaked.cookTimeMinutes,
        servings: tweaked.servings || null,
        servingsUnit: tweaked.servingsUnit || "servings",
        difficulty: tweaked.difficulty || null,
        notes: tweaked.notes,
      })
      .where(eq(recipes.id, recipeId));

    await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId));
    await db.delete(recipeSteps).where(eq(recipeSteps.recipeId, recipeId));
    await db.delete(recipeTags).where(eq(recipeTags.recipeId, recipeId));

    await Promise.all([
      tweaked.ingredients.length
        ? db.insert(recipeIngredients).values(
            tweaked.ingredients.map((ing, i) => ({
              recipeId,
              position: i,
              ingredientName: ing.ingredientName,
              amount: ing.amount || null,
              unit: ing.unit || null,
              preparation: ing.preparation || null,
              isOptional: ing.isOptional,
              groupLabel: ing.groupLabel || null,
            }))
          )
        : Promise.resolve(),
      tweaked.steps.length
        ? db.insert(recipeSteps).values(
            tweaked.steps.map((s, i) => ({
              recipeId,
              position: i,
              instruction: s.instruction,
              durationMinutes: s.durationMinutes ? parseInt(s.durationMinutes) : null,
              timerLabel: s.timerLabel || null,
            }))
          )
        : Promise.resolve(),
      tweaked.tags.length
        ? db.insert(recipeTags).values(tweaked.tags.map((tag) => ({ recipeId, tag })))
        : Promise.resolve(),
    ]);

    revalidatePath(`/recipes/${recipeId}`);
    revalidatePath("/recipes");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update recipe." };
  }
}

export async function toggleFavourite(recipeId: string) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [recipe] = await db
    .select({ isFavourite: recipes.isFavourite })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);

  if (!recipe) throw new Error("Recipe not found");

  await db
    .update(recipes)
    .set({ isFavourite: !recipe.isFavourite })
    .where(eq(recipes.id, recipeId));

  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath("/recipes");
}

export async function updateRecipeCookTime(
  recipeId: string,
  cookTimeMinutes: number
): Promise<void> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [recipe] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);

  if (!recipe) throw new Error("Recipe not found");

  await db
    .update(recipes)
    .set({ cookTimeMinutes })
    .where(eq(recipes.id, recipeId));

  revalidatePath(`/recipes/${recipeId}`);
}
