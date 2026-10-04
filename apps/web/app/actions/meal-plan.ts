"use server";

import { revalidatePath } from "next/cache";
import { requireSession, type Session } from "@/lib/session";
import * as mealPlanService from "@/lib/services/meal-plan";
import {
  MealPlanEntryNotFoundError,
  MealPlanNotFoundError,
  MealPlanValidationError,
} from "@/lib/services/meal-plan";
import { generateFullRecipe } from "./ai";
import type { MealPlanSlot } from "./ai";
import * as recipeService from "@/lib/services/recipes";
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

/** `weekStartDate` moves the entry into another week; omit it to stay put. */
export async function moveMealEntry(
  entryId: string,
  newDayOfWeek: number,
  weekStartDate?: string
) {
  const session = await requireSession();

  try {
    await mealPlanService.moveEntry(session, entryId, newDayOfWeek, weekStartDate);
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

/**
 * Replace a planned meal with another recipe in the same slot — the "Swap"
 * button on the planner's nutrition suggestions. Add first, then remove, so a
 * failure leaves an extra meal rather than a missing one.
 */
export async function swapMealEntryRecipe(
  entryId: string,
  weekStartDate: string,
  dayOfWeek: number,
  mealType: MealType,
  newRecipeId: string
) {
  const session = await requireSession();

  await mealPlanService.addEntry(session, weekStartDate, newRecipeId, dayOfWeek, mealType);
  try {
    await mealPlanService.removeEntry(session, entryId);
  } catch (err) {
    ignoreMissingEntry(err);
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

/** How many recipes to write at once. Enough to keep the wait short without
 *  hammering the AI provider with a whole week of requests in one burst. */
const NEW_RECIPE_CONCURRENCY = 3;

/**
 * Turn every "brand-new recipe" slot into a real, complete recipe.
 *
 * The meal planner returns invented slots as a concept — title, description,
 * cuisine, difficulty — with no recipeId. Generate the full recipe and save it,
 * then hand the planner the resulting id. A slot whose generation fails is left
 * untouched, so the planner still creates its stub and the week is never lost
 * over one bad response.
 */
async function fillNewSlots(
  session: Session,
  slots: MealPlanSlot[],
  memberIds: string[],
  heartHealthy: boolean
): Promise<MealPlanSlot[]> {
  const filled = [...slots];
  const pending = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => !slot.recipeId);

  for (let i = 0; i < pending.length; i += NEW_RECIPE_CONCURRENCY) {
    const batch = pending.slice(i, i + NEW_RECIPE_CONCURRENCY);
    await Promise.all(
      batch.map(async ({ slot, index }) => {
        try {
          const { recipe, error } = await generateFullRecipe(
            {
              title: slot.title,
              description: slot.description,
              cuisine: slot.cuisine,
              difficulty: slot.difficulty,
              tags: [],
            },
            memberIds,
            slot.mealType,
            undefined,
            { heartHealthy }
          );
          if (error || !recipe) throw new Error(error ?? "No recipe returned.");

          const { recipeId } = await recipeService.createRecipe(
            session,
            recipeService.generatedToWriteInput(recipe)
          );
          filled[index] = { ...slot, recipeId };
        } catch (err) {
          console.error(
            `[addAiGeneratedMealPlan] could not write "${slot.title}":`,
            err instanceof Error ? err.message : err
          );
        }
      })
    );
  }

  return filled;
}

export async function addAiGeneratedMealPlan(
  weekStartDate: string,
  slots: MealPlanSlot[],
  memberIds: string[] = [],
  options: { heartHealthy?: boolean } = {}
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

    // Slots the AI invented (no recipeId) are only a title and a one-line
    // description. Write them out in full before they reach the planner —
    // otherwise the plan links to an empty recipe with no ingredients or steps.
    const filledSlots = await fillNewSlots(session, slots, memberIds, !!options.heartHealthy);
    debug.recipesGenerated = filledSlots.filter(
      (s, i) => !slots[i]!.recipeId && s.recipeId
    ).length;

    const { planId, entryCount } = await mealPlanService.addAiGeneratedPlan(
      session,
      weekStartDate,
      filledSlots,
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
