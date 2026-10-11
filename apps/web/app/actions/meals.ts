"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import * as mealsService from "@/lib/services/meals";
import { MealNotFoundError, MealValidationError } from "@/lib/services/meals";
import {
  MealPlanGroupNotFoundError,
  MealPlanValidationError,
} from "@/lib/services/meal-plan";
import type { SaveMealInput } from "@/lib/services/meals";

/**
 * Web transport for saved meals. Domain logic lives in `lib/services/meals.ts`.
 *
 * Writes return `{ error }` for the failures a person can cause (an empty name,
 * a recipe deleted in another tab) so the editor can say what went wrong;
 * anything else still throws.
 */

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function expected(err: unknown): string | null {
  if (
    err instanceof MealValidationError ||
    err instanceof MealNotFoundError ||
    err instanceof MealPlanValidationError ||
    err instanceof MealPlanGroupNotFoundError
  ) {
    return err.message;
  }
  return null;
}

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn();
    revalidatePath("/meals");
    revalidatePath("/meal-plan");
    return { ok: true, data };
  } catch (err) {
    const message = expected(err);
    if (message) return { ok: false, error: message };
    throw err;
  }
}

export async function createSavedMeal(input: SaveMealInput) {
  const session = await requireSession();
  return run(() => mealsService.createMeal(session, input));
}

export async function updateSavedMeal(mealId: string, input: SaveMealInput) {
  const session = await requireSession();
  return run(() => mealsService.updateMeal(session, mealId, input));
}

export async function deleteSavedMeal(mealId: string) {
  const session = await requireSession();
  return run(() => mealsService.deleteMeal(session, mealId));
}

/** Save a planned meal's recipes as a new reusable meal. */
export async function saveMealGroupAsMeal(groupId: string, title?: string) {
  const session = await requireSession();
  return run(() => mealsService.saveGroupAsMeal(session, groupId, title));
}

/** Write a planned meal's recipes back over the saved meal it came from. */
export async function updateSavedMealFromGroup(groupId: string) {
  const session = await requireSession();
  return run(() => mealsService.updateMealFromGroup(session, groupId));
}
