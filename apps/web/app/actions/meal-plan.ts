"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import * as mealPlanService from "@/lib/services/meal-plan";
import {
  MealPlanEntryNotFoundError,
  MealPlanNotFoundError,
  MealPlanValidationError,
} from "@/lib/services/meal-plan";
import type { MealPlanSlot } from "./ai";
import type { MealType } from "@dishes/shared";

/**
 * Web transport for meal-plan writes. Domain logic lives in
 * `lib/services/meal-plan.ts`, shared with `app/api/v1/meal-plan/*`.
 *
 * Note: types are NOT re-exported from here — a "use server" file may only
 * export async functions. Consumers import `ShoppingAddResult` from
 * `@/lib/services/meal-plan` with `import type`.
 */

/**
 * These actions historically no-opped rather than throwing when the entry had
 * already gone (a stale card, a second click, another tab deleting it).
 * Preserved deliberately. Validation errors still throw — those are bugs.
 */
function ignoreMissingEntry(err: unknown): void {
  if (
    err instanceof MealPlanEntryNotFoundError ||
    err instanceof MealPlanNotFoundError
  ) {
    return;
  }
  throw err;
}

export async function addMealEntry(
  weekStartDate: string,
  recipeId: string,
  dayOfWeek: number,
  mealType: MealType,
  servings?: number | null
) {
  const session = await requireSession();

  await mealPlanService.addEntry(session, weekStartDate, recipeId, dayOfWeek, mealType, servings);

  revalidatePath("/meal-plan");
}

export async function moveMealEntry(entryId: string, newDayOfWeek: number) {
  const session = await requireSession();

  try {
    await mealPlanService.moveEntry(session, entryId, newDayOfWeek);
  } catch (err) {
    ignoreMissingEntry(err);
    return;
  }

  revalidatePath("/meal-plan");
}

export async function changeMealEntryType(entryId: string, newMealType: string) {
  const session = await requireSession();

  try {
    await mealPlanService.changeEntryType(session, entryId, newMealType);
  } catch (err) {
    ignoreMissingEntry(err);
    return;
  }

  revalidatePath("/meal-plan");
}

export async function removeMealEntry(entryId: string) {
  const session = await requireSession();

  try {
    await mealPlanService.removeEntry(session, entryId);
  } catch (err) {
    ignoreMissingEntry(err);
    return;
  }

  revalidatePath("/meal-plan");
}

export async function updateMealEntryServings(
  entryId: string,
  servings: number | null
) {
  const session = await requireSession();

  try {
    await mealPlanService.updateEntryServings(session, entryId, servings);
  } catch (err) {
    // A nonsensical servings value from a spinner is not worth an error overlay.
    if (err instanceof MealPlanValidationError) return;
    ignoreMissingEntry(err);
    return;
  }

  revalidatePath("/meal-plan");
}

export async function addAiGeneratedMealPlan(
  weekStartDate: string,
  slots: MealPlanSlot[],
  memberIds: string[] = []
): Promise<{ success?: boolean; error?: string; debug?: Record<string, unknown> }> {
  const debug: Record<string, unknown> = {
    weekStartDate,
    slotsReceived: slots.length,
    memberIds,
  };

  try {
    const session = await requireSession();
    debug.householdId = session.householdId;
    debug.memberId = session.memberId;

    const { planId, entryCount } = await mealPlanService.addAiGeneratedPlan(
      session,
      weekStartDate,
      slots,
      memberIds
    );
    debug.planId = planId;
    debug.entriesInserted = entryCount;

    console.log("[addAiGeneratedMealPlan] debug:", JSON.stringify(debug, null, 2));

    revalidatePath("/meal-plan");
    revalidatePath("/recipes");

    return { success: true, debug };
  } catch (err) {
    debug.error = err instanceof Error ? err.message : String(err);
    console.error("[addAiGeneratedMealPlan] error:", JSON.stringify(debug, null, 2));
    return {
      error: err instanceof Error ? err.message : "Failed to add meal plan.",
      debug,
    };
  }
}

export async function addMealEntryToShoppingList(
  entryId: string,
  opts?: { forceInclude?: string[] }
) {
  const session = await requireSession();

  const result = await mealPlanService.addEntryToShoppingList(session, entryId, opts);

  revalidatePath("/shopping");
  revalidatePath("/meal-plan");

  return result;
}

export async function getWeekMealSlots(weekStartDate: string) {
  const session = await requireSession();
  return mealPlanService.getWeekMealSlots(session, weekStartDate);
}

export async function generateShoppingFromWeek(
  mealPlanId: string,
  opts?: { forceInclude?: string[] }
) {
  const session = await requireSession();

  const result = await mealPlanService.generateShoppingFromWeek(
    session,
    mealPlanId,
    opts
  );

  revalidatePath("/shopping");
  revalidatePath("/meal-plan");

  return result;
}
