/**
 * Whole-meal reviews: one review when a planned combined meal is served,
 * covering the meal as a whole and each dish in it.
 *
 * Each dish gets an ordinary cook_history entry (so recipe ratings, cook-time
 * estimates and the taste profile keep learning per recipe), tied together by
 * a meal_cooks row holding the whole-meal rating and which dishes were eaten.
 * That combination is what lets a saved meal show how its versions compare.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { cookHistory, mealCooks, mealPlanEntries, mealPlanGroups, mealPlans, recipes } from "@dishes/db/schema";
import { db } from "@/lib/db";
import type { HouseholdContext } from "@/lib/session";
import { refreshTasteProfile } from "@/lib/services/taste-profile";
import {
  CookHistoryValidationError,
  assertRating,
  cleanMemberRatings,
  combineVoices,
  memberName,
} from "@/lib/services/cook-history";
import type { MemberRating } from "@dishes/db/schema";

export type MealCookDishInput = {
  recipeId: string;
  /** 0–10, the cook's own view of this dish; null = not rated. */
  rating?: number | null;
  /** What each person thought of this dish, by display name. */
  memberRatings?: MemberRating[] | null;
  notes?: string | null;
};

export type LogMealCookInput = {
  groupId: string;
  /** 0–10, the meal as a whole. */
  rating?: number | null;
  memberRatings?: MemberRating[] | null;
  cookedFor?: string[] | null;
  occasion?: string | null;
  notes?: string | null;
  actualDuration?: number | null;
  /** The dishes eaten; defaults to every dish of the planned meal. */
  dishes?: MealCookDishInput[];
};

export type LoggedMealCook = {
  id: string;
  /** Each dish's new cook entry, by recipe id — the photo goes on the main's. */
  cookIds: Record<string, string>;
};

/** Log a whole planned meal: one meal_cooks row, one cook entry per dish. */
export async function logMealCook(ctx: HouseholdContext, input: LogMealCookInput): Promise<LoggedMealCook> {
  assertRating(input.rating);
  const [group] = await db
    .select({ id: mealPlanGroups.id, title: mealPlanGroups.title, sourceMealId: mealPlanGroups.sourceMealId })
    .from(mealPlanGroups)
    .innerJoin(mealPlans, eq(mealPlanGroups.mealPlanId, mealPlans.id))
    .where(and(eq(mealPlanGroups.id, input.groupId), eq(mealPlans.householdId, ctx.householdId)))
    .limit(1);
  if (!group) throw new CookHistoryValidationError("Meal not found");

  const planned = await db
    .select({ recipeId: mealPlanEntries.recipeId })
    .from(mealPlanEntries)
    .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
    .where(and(eq(mealPlanEntries.groupId, group.id), eq(recipes.householdId, ctx.householdId)));
  const plannedIds = new Set(planned.map((p) => p.recipeId));

  // Only the meal's own dishes; each once.
  const given: MealCookDishInput[] = input.dishes?.length ? input.dishes : [...plannedIds].map((recipeId) => ({ recipeId }));
  const dishes = given
    .filter((d) => plannedIds.has(d.recipeId))
    .filter((d, i, all) => all.findIndex((o) => o.recipeId === d.recipeId) === i);
  if (!dishes.length) throw new CookHistoryValidationError("This meal has no dishes to log");
  for (const d of dishes) assertRating(d.rating);

  const ownName = await memberName(ctx);
  const cookedFor = input.cookedFor?.length ? input.cookedFor : null;
  const occasion = input.occasion?.trim() || null;
  const whole = combineVoices(ownName, input.rating, cleanMemberRatings(input.memberRatings));

  const [mealRow] = await db
      .insert(mealCooks)
      .values({
        householdId: ctx.householdId,
        groupId: group.id,
        mealId: group.sourceMealId,
        title: group.title,
        recipeIds: dishes.map((d) => d.recipeId).sort(),
        rating: whole.rating,
        memberRatings: whole.memberRatings,
        cookedFor,
        occasion,
        notes: input.notes?.trim() || null,
        actualDuration: input.actualDuration ?? null,
      })
      .returning({ id: mealCooks.id });
  const id = mealRow!.id;

  const cookIds: Record<string, string> = {};
  for (const d of dishes) {
    const voices = combineVoices(ownName, d.rating, cleanMemberRatings(d.memberRatings));
    const [entry] = await db
      .insert(cookHistory)
      .values({
        householdId: ctx.householdId,
        recipeId: d.recipeId,
        rating: voices.rating,
        memberRatings: voices.memberRatings,
        notes: d.notes?.trim() || null,
        occasion,
        cookedFor,
        // The meal's time isn't any one dish's, so it isn't used to retime them.
        actualDuration: null,
        mealCookId: id,
      })
      .returning({ id: cookHistory.id });
    cookIds[d.recipeId] = entry!.id;
  }

  void refreshTasteProfile(ctx.householdId);
  return { id, cookIds };
}

// --- Saved meals' ratings ----------------------------------------------------

export type MealCombination = {
  recipeIds: string[];
  titles: string[];
  /** 0–5 stars. */
  average: number;
  count: number;
};

export type SavedMealRating = {
  /** 0–5 stars over every rated cook of the meal. */
  average: number | null;
  /** Cooks of this saved meal, rated or not. */
  cookCount: number;
  lastCookedAt: string | null;
  /** Rated combinations, best first. */
  combinations: MealCombination[];
};

/** How each saved meal has gone down, keyed by meal id (meals never cooked are absent). */
export async function savedMealRatings(
  householdId: string,
  mealIds: string[]
): Promise<Map<string, SavedMealRating>> {
  const out = new Map<string, SavedMealRating>();
  if (!mealIds.length) return out;

  const rows = await db
    .select({
      mealId: mealCooks.mealId,
      recipeIds: mealCooks.recipeIds,
      rating: mealCooks.rating,
      cookedAt: mealCooks.cookedAt,
    })
    .from(mealCooks)
    .where(and(eq(mealCooks.householdId, householdId), inArray(mealCooks.mealId, mealIds)))
    .orderBy(desc(mealCooks.cookedAt));
  if (!rows.length) return out;

  const titleRows = await db
    .select({ id: recipes.id, title: recipes.title })
    .from(recipes)
    .where(and(eq(recipes.householdId, householdId), inArray(recipes.id, [...new Set(rows.flatMap((r) => r.recipeIds))])));
  const titleOf = new Map(titleRows.map((r) => [r.id, r.title]));

  const byMeal = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.mealId) continue;
    byMeal.set(r.mealId, [...(byMeal.get(r.mealId) ?? []), r]);
  }

  for (const [mealId, cooks] of byMeal) {
    const rated = cooks.filter((c) => c.rating !== null);
    const combos = new Map<string, { recipeIds: string[]; sum: number; count: number }>();
    for (const c of rated) {
      const key = [...c.recipeIds].sort().join(",");
      const combo = combos.get(key) ?? { recipeIds: [...c.recipeIds].sort(), sum: 0, count: 0 };
      combo.sum += Number(c.rating);
      combo.count++;
      combos.set(key, combo);
    }
    const stars = (tenths: number) => Math.round((tenths / 2) * 10) / 10;
    out.set(mealId, {
      average: rated.length ? stars(rated.reduce((a, c) => a + Number(c.rating), 0) / rated.length) : null,
      cookCount: cooks.length,
      lastCookedAt: cooks[0]?.cookedAt.toISOString() ?? null,
      combinations: [...combos.values()]
        .map((c) => ({
          recipeIds: c.recipeIds,
          titles: c.recipeIds.map((id) => titleOf.get(id) ?? "A deleted recipe"),
          average: stars(c.sum / c.count),
          count: c.count,
        }))
        .sort((a, b) => b.average - a.average || b.count - a.count),
    });
  }
  return out;
}
