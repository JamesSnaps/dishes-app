"use server";

import { revalidatePath } from "next/cache";
import { resolveIdentity } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import * as mealCooks from "@/lib/services/meal-cooks";

/**
 * The whole-meal review at the end of cooking a planned meal: the meal as a
 * whole and each dish, saved together (see lib/services/meal-cooks.ts).
 */
export async function logMealCook(
  input: mealCooks.LogMealCookInput
): Promise<mealCooks.LoggedMealCook> {
  const user = await resolveIdentity();
  const ctx = await requireHousehold(user);
  const result = await mealCooks.logMealCook(ctx, input);
  for (const recipeId of Object.keys(result.cookIds)) revalidatePath(`/recipes/${recipeId}`);
  revalidatePath("/recipes");
  revalidatePath("/meals");
  return result;
}
